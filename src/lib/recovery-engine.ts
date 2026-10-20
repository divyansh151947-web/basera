import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  conversations,
  followUps,
  leads,
  messages,
  notifications,
  tasks,
  users,
} from "@/db/schema";
import {
  getOrganizationRevenueRisk,
  type LeadRiskResult,
  type RiskLevel,
} from "./revenue-at-risk";
import { draftFollowUpMessage, scheduleNextFollowUp } from "./ai/followup-agent";
import { setConversationStatus } from "./data/conversations";
import { getLeadById } from "./data/leads";
import { createNotification } from "./data/org";

/**
 * AUTOMATIC LEAD RECOVERY ENGINE (Money-First Batch 2, V1).
 *
 * Consumes Revenue-at-Risk results and decides WHAT TO DO, deterministically.
 * No LLM, no learned model, no new tables: actions materialize as existing
 * followUps / tasks / notifications / conversation-status rows, so outcome
 * tracking is the rows themselves (pending/open/sent/done + timestamps).
 *
 * SAFETY POSTURE (conservative V1):
 * - Never recover closed/opted-out leads, leads with an upcoming
 *   appointment, or recently-engaged customers (<6h inbound).
 * - Customer-facing sends (AUTO) happen ONLY through the existing
 *   scheduleNextFollowUp path (which already enforces opt-out, closed
 *   status, and max attempts) with drafts from the existing grounded
 *   draftFollowUpMessage generator. Anything uncertain becomes an
 *   agent/manager task or alert instead.
 * - Anti-spam: a PENDING follow-up blocks new customer-facing actions; an
 *   open task blocks new alerts/escalations; SENT follow-ups inside a
 *   per-type cooldown window block repeats. Cooldowns (days): FOLLOW_UP 3,
 *   REACTIVATION 7, SITE_VISIT_RECOVERY 3, AGENT_ALERT 1,
 *   MANAGER_ESCALATION 3, HUMAN_HANDOFF 1.
 * - TERMINOLOGY: the engine tracks Recovery Attempts and Outcomes. It never
 *   claims revenue was recovered — a sent message is not a closed deal.
 */

export type RecoveryActionType =
  | "FOLLOW_UP"
  | "AGENT_ALERT"
  | "MANAGER_ESCALATION"
  | "REACTIVATION"
  | "SITE_VISIT_RECOVERY"
  | "HUMAN_HANDOFF";

/** ALERT = tell someone. PREPARE = draft + task for approval. AUTO = the
 *  existing follow-up pipeline sends when due (still human-stoppable). */
export type RecoveryAutomation = "ALERT" | "PREPARE" | "AUTO";
export type RecoveryPriority = "P1" | "P2" | "P3";

export const RECOVERY_COOLDOWN_DAYS: Record<RecoveryActionType, number> = {
  FOLLOW_UP: 3,
  AGENT_ALERT: 1,
  MANAGER_ESCALATION: 3,
  REACTIVATION: 7,
  SITE_VISIT_RECOVERY: 3,
  HUMAN_HANDOFF: 1,
};

const HIGH_VALUE_INR = 5_000_000;
const RECENT_INBOUND_HOURS = 6;
const ENGAGED_INBOUND_HOURS = 24;

export interface RecoveryContext {
  leadId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  riskReasons: string[];
  leadScore: number;
  hasValue: boolean;
  status: string;
  optedOut?: boolean;
  lastInboundHoursAgo: number | null;
  lastOutboundHoursAgo: number | null;
  followUpOverdue: boolean;
  /** Past-due PENDING rows plus FAILED rows (failed sends are missed outreach). */
  overdueFollowUpCount: number;
  /** Oldest age (hours) of the overdue/failed follow-up set, if any. */
  mostOverdueHoursAgo?: number | null;
  hasUpcomingAppointment: boolean;
  hasMissedVisit: boolean;
  siteVisitInterest?: boolean | null;
  handoffAwaitingHuman: boolean;
  assignedAgentId?: string | null;
  channel: string;
  pendingFollowUp: boolean;
  daysSinceLastAutoOutreach: number | null;
  openTaskExists: boolean;
}

export interface RecoveryDecision {
  shouldRecover: boolean;
  actionType: RecoveryActionType | null;
  automation: RecoveryAutomation | null;
  priority: RecoveryPriority | null;
  reasons: string[];
  recommendedChannel: string | null;
  cooldownUntil: string | null;
  noActionReason: string | null;
}

export interface RecoveryCandidate {
  leadId: string;
  leadName: string | null;
  risk: LeadRiskResult;
  decision: RecoveryDecision;
}

function basePriority(riskLevel: RiskLevel): RecoveryPriority {
  if (riskLevel === "CRITICAL") return "P1";
  if (riskLevel === "HIGH") return "P2";
  return "P3";
}

function noRecovery(reason: string): RecoveryDecision {
  return {
    shouldRecover: false,
    actionType: null,
    automation: null,
    priority: null,
    reasons: [],
    recommendedChannel: null,
    cooldownUntil: null,
    noActionReason: reason,
  };
}

/** Pure, deterministic decision. All time comes from the caller (testable). */
export function evaluateRecoveryDecision(ctx: RecoveryContext, nowMs: number = Date.now()): RecoveryDecision {
  const reasons = [...ctx.riskReasons.slice(0, 2)];

  // --- Absolute guards: never recover ---
  if (ctx.riskLevel === "LOW") return noRecovery("Lead risk is LOW — nothing to recover.");
  if (["CONVERTED", "LOST"].includes(ctx.status)) return noRecovery("Lead is closed — recovery is inappropriate.");
  if (ctx.optedOut) return noRecovery("Lead opted out — recovery is inappropriate.");
  if (ctx.hasUpcomingAppointment && !ctx.hasMissedVisit) {
    return noRecovery("An upcoming appointment already exists — recovery would be noise.");
  }

  // --- Recent engagement: never spam a live conversation ---
  const inbound = ctx.lastInboundHoursAgo;

  // --- Cooldown / duplicate prevention ---
  // An open agent task suppresses everything (a human already owns it).
  // A stuck queue (2+ overdue, or one overdue >48h) still escalates to a
  // manager — silence is worse than a second pair of eyes. Anything else
  // in-flight suppresses new sends, and a fresh auto-send suppresses
  // repeats inside its window.
  if (ctx.openTaskExists) {
    return noRecovery("An agent task is already open for this lead.");
  }
  const stuckQueue =
    ctx.overdueFollowUpCount >= 2 ||
    (ctx.overdueFollowUpCount >= 1 && (ctx.mostOverdueHoursAgo ?? 0) > 48);
  const customerFacing: RecoveryActionType[] = ["FOLLOW_UP", "REACTIVATION", "SITE_VISIT_RECOVERY"];
  let sendsBlockedReason: string | null = null;
  let sendsCooldownUntil: string | null = null;
  if (!stuckQueue) {
    if (ctx.pendingFollowUp) {
      sendsBlockedReason = "A follow-up is already pending for this lead.";
    } else if (ctx.daysSinceLastAutoOutreach != null) {
      const blocking = customerFacing.filter((t) => ctx.daysSinceLastAutoOutreach! < RECOVERY_COOLDOWN_DAYS[t]);
      if (blocking.length === customerFacing.length) {
        sendsBlockedReason = "Recent automated outreach is still inside its cooldown window.";
        sendsCooldownUntil = new Date(nowMs + Math.min(...customerFacing.map((t) => RECOVERY_COOLDOWN_DAYS[t])) * 86_400_000).toISOString();
      }
    }
  }

  if (inbound != null && inbound < RECENT_INBOUND_HOURS) {
    const outboundMissing = ctx.lastOutboundHoursAgo == null || ctx.lastOutboundHoursAgo > inbound + 12;
    // …unless equivalent work is already queued — no nagging about it.
    if (outboundMissing && (ctx.riskLevel === "HIGH" || ctx.riskLevel === "CRITICAL") && !ctx.pendingFollowUp) {
      // Rule B: customer just wrote, nobody answered — page the owner, do
      // NOT send another automated customer message.
      return {
        shouldRecover: true,
        actionType: "AGENT_ALERT",
        automation: "ALERT",
        priority: ctx.riskLevel === "CRITICAL" ? "P1" : "P2",
        reasons: [...reasons, "Customer contacted recently but has no timely agent response."],
        recommendedChannel: null,
        cooldownUntil: null,
        noActionReason: null,
      };
    }
    return noRecovery("Customer engaged very recently — no action to avoid spam.");
  }

  const engagedRecently = inbound != null && inbound < ENGAGED_INBOUND_HOURS;

  // --- Rule: handoff waiting with no owner ---
  if (ctx.handoffAwaitingHuman && !ctx.assignedAgentId) {
    return {
      shouldRecover: true,
      actionType: "HUMAN_HANDOFF",
      automation: "ALERT",
      priority: ctx.riskLevel === "CRITICAL" ? "P1" : "P2",
      reasons: [...reasons, "Conversation awaits a human with no agent assigned."],
      recommendedChannel: null,
      cooldownUntil: null,
      noActionReason: null,
    };
  }

  // --- Rule E: missed site visit ---
  if (ctx.hasMissedVisit) {
    return {
      shouldRecover: true,
      actionType: "SITE_VISIT_RECOVERY",
      automation: "PREPARE",
      priority: ctx.riskLevel === "CRITICAL" ? "P1" : "P2",
      reasons: [...reasons, "A site visit was missed — needs rescheduling, not automation."],
      recommendedChannel: ctx.channel,
      cooldownUntil: null,
      noActionReason: null,
    };
  }

  // --- Rule D: stuck queue (repeated or long-overdue follow-ups) ---
  // Evaluated BEFORE the send gates: a queue that is not clearing itself
  // needs manager eyes even while individual sends stay suppressed.
  if (stuckQueue) {
    return {
      shouldRecover: true,
      actionType: "MANAGER_ESCALATION",
      automation: "ALERT",
      priority: ctx.riskLevel === "CRITICAL" || ctx.riskLevel === "HIGH" ? "P1" : "P2",
      reasons: [...reasons, `${ctx.overdueFollowUpCount} follow-up${ctx.overdueFollowUpCount === 1 ? " is" : "s are"} overdue — pattern needs a manager.`],
      recommendedChannel: null,
      cooldownUntil: null,
      noActionReason: null,
    };
  }

  // --- Rule A: overdue follow-up + quiet customer → follow up (AUTO).
  // Send-gated: a pending or cooling-down queue must not receive doubles.
  const staleCustomer = inbound == null || inbound >= ENGAGED_INBOUND_HOURS;
  if ((ctx.followUpOverdue || ctx.overdueFollowUpCount > 0) && staleCustomer && !sendsBlockedReason) {
    return {
      shouldRecover: true,
      actionType: "FOLLOW_UP",
      automation: "AUTO",
      priority: basePriority(ctx.riskLevel),
      reasons: [...reasons, "Follow-up is overdue and the customer has gone quiet."],
      recommendedChannel: ctx.channel,
      cooldownUntil: null,
      noActionReason: null,
    };
  }

  // --- Site-visit interest with no visit on the books ---
  if (ctx.siteVisitInterest && (ctx.riskLevel === "HIGH" || ctx.riskLevel === "CRITICAL") && !sendsBlockedReason) {
    return {
      shouldRecover: true,
      actionType: "SITE_VISIT_RECOVERY",
      automation: "PREPARE",
      priority: ctx.riskLevel === "CRITICAL" ? "P1" : "P2",
      reasons: [...reasons, "Lead wants a site visit but none is scheduled."],
      recommendedChannel: ctx.channel,
      cooldownUntil: null,
      noActionReason: null,
    };
  }

  // --- Reactivation for quiet, valuable, high-intent leads ---
  if (!engagedRecently && (ctx.riskLevel === "HIGH" || ctx.riskLevel === "CRITICAL") && ctx.hasValue && ctx.leadScore >= 60 && !sendsBlockedReason) {
    return {
      shouldRecover: true,
      actionType: "REACTIVATION",
      automation: ctx.riskLevel === "CRITICAL" ? "AUTO" : "PREPARE",
      priority: ctx.riskLevel === "CRITICAL" ? "P1" : "P2",
      reasons: [...reasons, "High-intent lead has gone quiet with value on the table."],
      recommendedChannel: ctx.channel,
      cooldownUntil: null,
      noActionReason: null,
    };
  }

  // --- Rule B (general): agent response missing on an engaged lead.
  // Suppressed while equivalent follow-up work is already queued.
  const outboundStale =
    ctx.lastOutboundHoursAgo == null || (inbound != null && ctx.lastOutboundHoursAgo > inbound + 12);
  if (!ctx.pendingFollowUp && outboundStale && (ctx.riskLevel === "HIGH" || ctx.riskLevel === "CRITICAL" || ctx.followUpOverdue)) {
    return {
      shouldRecover: true,
      actionType: "AGENT_ALERT",
      automation: "ALERT",
      priority: ctx.riskLevel === "CRITICAL" ? "P1" : "P2",
      reasons: [...reasons, "No timely agent response to the customer."],
      recommendedChannel: null,
      cooldownUntil: null,
      noActionReason: null,
    };
  }

  // --- Rule C: high-value critical floor — never leave these without an owner-visible action ---
  if (ctx.riskLevel === "CRITICAL") {
    return {
      shouldRecover: true,
      actionType: ctx.assignedAgentId ? "AGENT_ALERT" : "MANAGER_ESCALATION",
      automation: "ALERT",
      priority: "P1",
      reasons: [...reasons, "Critical risk requires a human owner."],
      recommendedChannel: null,
      cooldownUntil: null,
      noActionReason: null,
    };
  }

  if (sendsBlockedReason) {
    return { ...noRecovery(sendsBlockedReason), cooldownUntil: sendsCooldownUntil };
  }

  return noRecovery("No recovery rule fired for this lead's current state.");
}

export interface ExecutedRecovery {
  attempted: boolean;
  actionType: RecoveryActionType | null;
  automation: RecoveryAutomation | null;
  recordId: string | null;
  recordKind: "followUp" | "task" | "notification" | "handoff" | null;
  /** Human-readable outcome of the ATTEMPT. Never a revenue claim. */
  outcome: string;
}

/**
 * Executes an approved decision using existing rows only. All writes carry
 * organizationId; nothing here invents money, property facts, or messages —
 * customer-facing text always comes from the grounded follow-up drafter.
 */
export async function executeRecoveryAction(
  organizationId: string,
  leadId: string,
  decision: RecoveryDecision,
  exec: { assignedAgentId?: string | null; conversationId?: string | null; channel?: string; actorUserId?: string }
): Promise<ExecutedRecovery> {
  if (!decision.shouldRecover || !decision.actionType) {
    return { attempted: false, actionType: null, automation: null, recordId: null, recordKind: null, outcome: "No recovery warranted." };
  }

  const managers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), inArray(users.role, ["BUSINESS_ADMIN", "MANAGER"])));
  const managerIds = managers.map((m) => m.id);
  const ownerId = exec.assignedAgentId ?? managerIds[0] ?? exec.actorUserId ?? null;

  const notify = async (userId: string | null, title: string, body: string) => {
    await createNotification(organizationId, { userId: userId ?? undefined, type: "RECOVERY_ACTION", title, body });
  };

  // PREPARE path shared by non-AUTO customer-facing decisions: one agent
  // task holding the grounded draft for approval — never a send. (The tasks
  // table has no body column, so the draft travels inside the title.)
  const prepareDraftForApproval = async (): Promise<ExecutedRecovery> => {
    if (!ownerId) {
      return { attempted: false, actionType: decision.actionType, automation: decision.automation, recordId: null, recordKind: null, outcome: "No owner exists to review the draft." };
    }
    const draft = await draftFollowUpMessage(organizationId, leadId);
    const [task] = await db
      .insert(tasks)
      .values({ organizationId, leadId, assigneeId: ownerId, title: `Review recovery message (${decision.priority}): ${draft.slice(0, 200)}`, dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() })
      .returning();
    await notify(ownerId, "Recovery message ready for review", decision.reasons.join(" "));
    return { attempted: true, actionType: decision.actionType, automation: "PREPARE", recordId: task.id, recordKind: "task", outcome: "Draft prepared for agent approval (not sent)." };
  };

  switch (decision.actionType) {
    case "FOLLOW_UP":
    case "REACTIVATION": {
      if (decision.automation !== "AUTO") {
        return await prepareDraftForApproval();
      }
      // The existing scheduler path enforces opt-out/closed/max-attempts.
      const existing = await db
        .select({ attemptNumber: followUps.attemptNumber })
        .from(followUps)
        .where(and(eq(followUps.organizationId, organizationId), eq(followUps.leadId, leadId)));
      const maxAttempt = existing.reduce((m, r) => Math.max(m, r.attemptNumber), 0);
      const created = await scheduleNextFollowUp(organizationId, leadId, maxAttempt);
      if (!created) {
        // Scheduler refused (max attempts / opted out / closed mid-flight):
        // fall back to an agent task rather than forcing a send.
        if (!ownerId) return { attempted: false, actionType: decision.actionType, automation: decision.automation, recordId: null, recordKind: null, outcome: "Follow-up refused by scheduler and no owner exists." };
        const [task] = await db
          .insert(tasks)
          .values({ organizationId, leadId, assigneeId: ownerId, title: `Recovery follow-up needed (${decision.priority})`, dueAt: new Date(Date.now() + 86_400_000).toISOString() })
          .returning();
        await notify(ownerId, "Recovery follow-up needed", decision.reasons.join(" "));
        return { attempted: true, actionType: "AGENT_ALERT", automation: "ALERT", recordId: task.id, recordKind: "task", outcome: "Scheduler declined; agent task created instead." };
      }
      const draft = await draftFollowUpMessage(organizationId, leadId);
      await db.update(followUps).set({ messageDraft: draft }).where(eq(followUps.id, created.id));
      await notify(ownerId, "Recovery follow-up scheduled", `A ${decision.actionType === "REACTIVATION" ? "reactivation" : "follow-up"} message was scheduled for review in the follow-up queue.`);
      return { attempted: true, actionType: decision.actionType, automation: "AUTO", recordId: created.id, recordKind: "followUp", outcome: "Recovery follow-up scheduled (pending send)." };
    }

    case "AGENT_ALERT":
    case "SITE_VISIT_RECOVERY": {
      if (!ownerId) {
        return { attempted: false, actionType: decision.actionType, automation: decision.automation, recordId: null, recordKind: null, outcome: "No owner or manager exists to assign the task." };
      }
      const title =
        decision.actionType === "SITE_VISIT_RECOVERY"
          ? `Reschedule site visit (${decision.priority})`
          : `Recover at-risk lead (${decision.priority})`;
      const [task] = await db
        .insert(tasks)
        .values({ organizationId, leadId, assigneeId: ownerId, title, dueAt: new Date(Date.now() + (decision.priority === "P1" ? 86_400_000 : 3 * 86_400_000)).toISOString() })
        .returning();
      await notify(ownerId, title, decision.reasons.join(" "));
      const automation: RecoveryAutomation = decision.actionType === "SITE_VISIT_RECOVERY" ? "PREPARE" : "ALERT";
      return { attempted: true, actionType: decision.actionType, automation, recordId: task.id, recordKind: "task", outcome: "Agent task created with recovery context." };
    }

    case "MANAGER_ESCALATION": {
      const target = managerIds[0] ?? null;
      if (!target) {
        return { attempted: false, actionType: decision.actionType, automation: decision.automation, recordId: null, recordKind: null, outcome: "No manager exists to escalate to." };
      }
      const [task] = await db
        .insert(tasks)
        .values({ organizationId, leadId, assigneeId: target, title: `Escalated at-risk lead (${decision.priority})`, dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() })
        .returning();
      for (const managerId of managerIds) {
        await notify(managerId, "At-risk lead escalated", decision.reasons.join(" "));
      }
      return { attempted: true, actionType: decision.actionType, automation: "ALERT", recordId: task.id, recordKind: "task", outcome: "Manager escalation task created." };
    }

    case "HUMAN_HANDOFF": {
      if (exec.conversationId) {
        await setConversationStatus(organizationId, exec.conversationId, "HUMAN_HANDLING", "Recovery engine requested human takeover");
      }
      const target = ownerId;
      if (target) await notify(target, "Human takeover requested", decision.reasons.join(" "));
      else {
        for (const managerId of managerIds) {
          await notify(managerId, "Human takeover requested", decision.reasons.join(" "));
        }
      }
      return { attempted: true, actionType: decision.actionType, automation: "ALERT", recordId: exec.conversationId ?? null, recordKind: "handoff", outcome: "Conversation routed for human takeover." };
    }

    default: {
      // PREPARE-only decisions land here when executed.
      if (decision.automation === "PREPARE") return await prepareDraftForApproval();
      return { attempted: false, actionType: decision.actionType, automation: decision.automation, recordId: null, recordKind: null, outcome: "No safe execution path for this decision." };
    }
  }
}

export interface RecoveryCandidateView {
  leadId: string;
  leadName: string | null;
  risk: LeadRiskResult;
  decision: RecoveryDecision;
}

export interface RecoveryCandidates {
  evaluated: number;
  candidates: RecoveryCandidateView[];
  calculatedAt: string;
}

/**
 * Candidates for one organization: top at-risk leads evaluated with bounded
 * per-lead context (latest conversation + recent follow-ups/appointments).
 * Agent-scoped callers pass assignedAgentId (own + unassigned only).
 */
export interface SingleLeadRecovery {
  lead: { id: string; name: string | null; status: string };
  risk: LeadRiskResult | null;
  decision: RecoveryDecision;
}

/**
 * Shared enrichment: builds the decision context for one lead from
 * org-scoped rows. Used by both the candidates sweep and single-lead
 * execution so the rules see identical inputs on both paths.
 */
export async function evaluateSingleLeadRecovery(
  organizationId: string,
  leadId: string,
  nowMs: number = Date.now()
): Promise<SingleLeadRecovery | null> {
  const lead = await getLeadById(organizationId, leadId);
  if (!lead) return null;

  const [risk, convRows, fuRows, apptRows, openTasks] = await Promise.all([
    getOrganizationRevenueRisk(organizationId, { now: nowMs, topLimit: 1000 }),
    db.select().from(conversations).where(and(eq(conversations.organizationId, organizationId), eq(conversations.leadId, leadId))),
    db.select().from(followUps).where(and(eq(followUps.organizationId, organizationId), eq(followUps.leadId, leadId))),
    db.select().from(appointments).where(and(eq(appointments.organizationId, organizationId), eq(appointments.leadId, leadId))),
    db.select({ id: tasks.id }).from(tasks).where(
      and(eq(tasks.organizationId, organizationId), eq(tasks.leadId, leadId), eq(tasks.isDone, false))
    ),
  ]);
  const item = risk.topRisks.find((r) => r.leadId === leadId) ?? null;
  // A lead outside the at-risk set still gets an explicit no-recovery
  // verdict (LOW risk), never an invented one.
  const effectiveRisk: LeadRiskResult = item ?? {
    leadId: lead.id,
    leadName: lead.name,
    riskScore: 0,
    riskLevel: "LOW",
    revenueAtRisk: null,
    reasons: [],
    propertyId: null,
    propertyValue: lead.budgetMaxInr,
    leadScore: lead.score ?? 0,
    lastInteractionAt: null,
    followUpStatus: "NONE",
    appointmentStatus: "NONE",
    calculatedAt: new Date(nowMs).toISOString(),
  };

  const latestConv = [...convRows].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  const leadMessages = latestConv
    ? await db.select({ sender: messages.sender, createdAt: messages.createdAt }).from(messages).where(eq(messages.conversationId, latestConv.id)).orderBy(desc(messages.createdAt)).limit(20)
    : [];
  const toHours = (iso: string | null) => (iso ? (nowMs - new Date(iso).getTime()) / 3_600_000 : null);
  const inboundMsg = leadMessages.find((x) => x.sender === "LEAD") ?? null;
  const outboundMsg = leadMessages.find((x) => x.sender === "AI" || x.sender === "AGENT") ?? null;
  const inboundH = inboundMsg ? toHours(inboundMsg.createdAt) : toHours(effectiveRisk.lastInteractionAt);
  const pastDuePending = fuRows.filter((f) => f.status === "PENDING" && f.scheduledFor <= effectiveRisk.calculatedAt);
  const failedSends = fuRows.filter((f) => f.status === "FAILED");
  const overdueCount = pastDuePending.length + failedSends.length;
  const overdueAges = [
    ...pastDuePending.map((f) => (nowMs - new Date(f.scheduledFor).getTime()) / 3_600_000),
    ...failedSends.map((f) => (nowMs - new Date(f.createdAt).getTime()) / 3_600_000),
  ];
  const sentTimes = fuRows.filter((f) => f.status === "SENT" && f.sentAt != null).map((f) => new Date(f.sentAt as string).getTime());

  const decision = evaluateRecoveryDecision(
    {
      leadId: lead.id,
      riskLevel: effectiveRisk.riskLevel,
      riskScore: effectiveRisk.riskScore,
      riskReasons: effectiveRisk.reasons,
      leadScore: effectiveRisk.leadScore,
      hasValue: effectiveRisk.revenueAtRisk != null || effectiveRisk.propertyValue != null,
      status: lead.status,
      optedOut: lead.optedOut,
      lastInboundHoursAgo: inboundH,
      lastOutboundHoursAgo: outboundMsg ? toHours(outboundMsg.createdAt) : null,
      followUpOverdue: effectiveRisk.followUpStatus === "OVERDUE",
      overdueFollowUpCount: overdueCount,
      mostOverdueHoursAgo: overdueAges.length > 0 ? Math.max(...overdueAges) : null,
      hasUpcomingAppointment: apptRows.some((a) => ["SCHEDULED", "CONFIRMED"].includes(a.status) && a.scheduledAt >= effectiveRisk.calculatedAt),
      hasMissedVisit: apptRows.some((a) => a.status === "NO_SHOW"),
      siteVisitInterest: lead.siteVisitInterest,
      handoffAwaitingHuman: latestConv?.status === "HUMAN_HANDLING",
      assignedAgentId: lead.assignedAgentId,
      channel: latestConv?.channel ?? "WEBSITE_CHAT",
      pendingFollowUp: fuRows.some((f) => f.status === "PENDING"),
      daysSinceLastAutoOutreach: sentTimes.length === 0 ? null : (nowMs - Math.max(...sentTimes)) / 86_400_000,
      openTaskExists: openTasks.length > 0,
    },
    nowMs
  );

  return {
    lead: { id: lead.id, name: lead.name, status: lead.status },
    risk: item,
    decision,
  };
}

export async function getOrganizationRecoveryCandidates(
  organizationId: string,
  opts: { now?: Date | number; assignedAgentId?: string | null; limit?: number } = {}
): Promise<RecoveryCandidates> {
  const nowMs = opts.now == null ? Date.now() : typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const limit = opts.limit ?? 10;

  const risk = await getOrganizationRevenueRisk(
    organizationId,
    opts.assignedAgentId !== undefined ? { now: nowMs, assignedAgentId: opts.assignedAgentId, topLimit: limit * 2 } : { now: nowMs, topLimit: limit * 2 }
  );
  const scoped = risk.topRisks.filter((r) => r.riskLevel !== "LOW").slice(0, limit);
  if (scoped.length === 0) {
    return { evaluated: 0, candidates: [], calculatedAt: risk.calculatedAt };
  }
  const leadIds = scoped.map((r) => r.leadId);

  const [leadRows, convRows, fuRows, apptRows, openTasks] = await Promise.all([
    db.select().from(leads).where(and(eq(leads.organizationId, organizationId), inArray(leads.id, leadIds))),
    db.select().from(conversations).where(eq(conversations.organizationId, organizationId)),
    db.select().from(followUps).where(eq(followUps.organizationId, organizationId)),
    db.select().from(appointments).where(eq(appointments.organizationId, organizationId)),
    db.select({ leadId: tasks.leadId }).from(tasks).where(
      and(eq(tasks.organizationId, organizationId), inArray(tasks.leadId, leadIds), eq(tasks.isDone, false))
    ),
  ]);
  const leadById = new Map(leadRows.map((l) => [l.id, l]));
  const openTaskByLead = new Set(openTasks.map((t) => t.leadId).filter((v): v is string => v != null));

  const candidates: RecoveryCandidateView[] = [];
  for (const item of scoped) {
    const lead = leadById.get(item.leadId);
    if (!lead) continue;
    const convs = convRows.filter((c) => c.leadId === lead.id);
    const latestConv = convs.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    const leadMessages = latestConv
      ? await db.select({ sender: messages.sender, createdAt: messages.createdAt }).from(messages).where(eq(messages.conversationId, latestConv.id)).orderBy(desc(messages.createdAt)).limit(20)
      : [];
    const inboundH = (() => {
      const m = leadMessages.find((x) => x.sender === "LEAD");
      if (m) return (nowMs - new Date(m.createdAt).getTime()) / 3_600_000;
      if (item.lastInteractionAt) return (nowMs - new Date(item.lastInteractionAt).getTime()) / 3_600_000;
      return null;
    })();
    const outboundH = (() => {
      const m = leadMessages.find((x) => x.sender === "AI" || x.sender === "AGENT");
      return m ? (nowMs - new Date(m.createdAt).getTime()) / 3_600_000 : null;
    })();
    const leadFus = fuRows.filter((f) => f.leadId === lead.id);
    const pendingFu = leadFus.some((f) => f.status === "PENDING");
    // Overdue set: past-due PENDING rows plus FAILED sends (a failed send is
    // missed outreach). Failed rows use their creation time for age.
    const pastDuePending = leadFus.filter((f) => f.status === "PENDING" && f.scheduledFor <= item.calculatedAt);
    const failedSends = leadFus.filter((f) => f.status === "FAILED");
    const overdueCount = pastDuePending.length + failedSends.length;
    const overdueAges = [
      ...pastDuePending.map((f) => (nowMs - new Date(f.scheduledFor).getTime()) / 3_600_000),
      ...failedSends.map((f) => (nowMs - new Date(f.createdAt).getTime()) / 3_600_000),
    ];
    const mostOverdue = overdueAges.length > 0 ? Math.max(...overdueAges) : null;
    const daysSinceAuto = (() => {
      const sent = leadFus.filter((f) => f.status === "SENT" && f.sentAt != null).map((f) => new Date(f.sentAt as string).getTime());
      return sent.length === 0 ? null : (nowMs - Math.max(...sent)) / 86_400_000;
    })();
    const leadAppts = apptRows.filter((a) => a.leadId === lead.id);
    const upcoming = leadAppts.some((a) => ["SCHEDULED", "CONFIRMED"].includes(a.status) && a.scheduledAt >= item.calculatedAt);
    const missed = leadAppts.some((a) => a.status === "NO_SHOW");

    const decision = evaluateRecoveryDecision(
      {
        leadId: lead.id,
        riskLevel: item.riskLevel,
        riskScore: item.riskScore,
        riskReasons: item.reasons,
        leadScore: item.leadScore,
        hasValue: item.revenueAtRisk != null || item.propertyValue != null,
        status: lead.status,
        optedOut: lead.optedOut,
        lastInboundHoursAgo: inboundH,
        lastOutboundHoursAgo: outboundH,
        followUpOverdue: item.followUpStatus === "OVERDUE",
        overdueFollowUpCount: overdueCount,
        mostOverdueHoursAgo: mostOverdue,
        hasUpcomingAppointment: upcoming,
        hasMissedVisit: missed,
        siteVisitInterest: lead.siteVisitInterest,
        handoffAwaitingHuman: latestConv?.status === "HUMAN_HANDLING",
        assignedAgentId: lead.assignedAgentId,
        channel: latestConv?.channel ?? "WEBSITE_CHAT",
        pendingFollowUp: pendingFu,
        daysSinceLastAutoOutreach: daysSinceAuto,
        openTaskExists: openTaskByLead.has(lead.id),
      },
      nowMs
    );

    if (decision.shouldRecover) {
      candidates.push({ leadId: lead.id, leadName: lead.name, risk: item, decision });
    }
  }

  return { evaluated: scoped.length, candidates, calculatedAt: risk.calculatedAt };
}
