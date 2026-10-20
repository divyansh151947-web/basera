import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  conversations,
  followUps,
  leadPropertyInterests,
  leads,
  messages,
  tasks,
} from "@/db/schema";
import {
  getOrganizationRevenueRisk,
  type LeadRiskResult,
  type RiskLevel,
} from "./revenue-at-risk";
import { evaluateRecoveryDecision } from "./recovery-engine";

/**
 * NEXT BEST ACTION ENGINE (Money-First Batch 3, V1).
 *
 * A thin deterministic layer answering: "given everything Basera knows
 * about this lead, what is the single most useful action next?" It does NOT
 * reimplement risk scoring or recovery rules — it consumes
 * calculateLeadRevenueRisk OUTPUT (score/level/reasons/revenue) and
 * evaluateRecoveryDecision, then adds sales-context signals only the
 * appointment book and the message thread can provide (unanswered inbound,
 * imminent/completed visits, property-fit gaps).
 *
 * Priority hierarchy (first match wins):
 *  1. Unanswered customer message → RESPOND_TO_CUSTOMER
 *  2. Unconfirmed site visit within 48h → CONFIRM_SITE_VISIT
 *  3. Completed visit with no contact after → FOLLOW_UP_AFTER_SITE_VISIT
 *  4. Qualified + wants a visit + nothing booked → BOOK_SITE_VISIT
 *  5. Recovery decision mapping (FOLLOW_UP / REACTIVATE_LEAD /
 *     ESCALATE_TO_MANAGER / HANDOFF_TO_HUMAN / BOOK_SITE_VISIT)
 *  6. Interest exists but no EXACT/CLOSE match → FIND_BETTER_PROPERTY
 *  7. Dormant high-intent lead with value → REACTIVATE_LEAD
 *  8. Active queue (pending/cooldown) → WAIT_AND_MONITOR
 *  9. Fallback: LOW → NO_ACTION, else WAIT_AND_MONITOR
 *
 * Priority score (0–100, deterministic) blends urgency first, value second:
 * a ₹2Cr lead that wrote 5 minutes ago outranks generic reactivation.
 * Confidence (HIGH/MEDIUM/LOW) states how strongly structured signals
 * support the action — NOT a calibrated probability. No money, odds, or
 * probabilities are ever invented; missing value stays null.
 */

export type NextBestAction =
  | "RESPOND_TO_CUSTOMER"
  | "FOLLOW_UP"
  | "BOOK_SITE_VISIT"
  | "CONFIRM_SITE_VISIT"
  | "FOLLOW_UP_AFTER_SITE_VISIT"
  | "REACTIVATE_LEAD"
  | "FIND_BETTER_PROPERTY"
  | "ESCALATE_TO_MANAGER"
  | "HANDOFF_TO_HUMAN"
  | "WAIT_AND_MONITOR"
  | "NO_ACTION";

export type NbaConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface NbaInput {
  leadId: string;
  leadName?: string | null;
  status: string;
  optedOut?: boolean;
  leadScore: number;
  riskLevel: RiskLevel;
  riskScore: number;
  riskReasons: string[];
  revenueAtRisk?: number | null;
  hasValue: boolean;
  lastInboundHoursAgo: number | null;
  lastOutboundHoursAgo: number | null;
  followUpOverdue: boolean;
  overdueFollowUpCount: number;
  pendingFollowUp: boolean;
  daysSinceLastAutoOutreach: number | null;
  openTaskExists: boolean;
  upcomingVisitInHours: number | null;
  upcomingVisitConfirmed: boolean;
  completedVisitWithoutFollowUp: boolean;
  hasAnyAppointment: boolean;
  siteVisitInterest?: boolean | null;
  qualifiedForVisit: boolean;
  hasStrongMatch: boolean;
  hasAnyInterest: boolean;
  handoffAwaitingHuman: boolean;
  assignedAgentId?: string | null;
  channel: string;
  recoveryAction: string | null;
  recoveryShouldAct: boolean;
}

export interface NextBestActionResult {
  leadId: string;
  leadName: string | null;
  action: NextBestAction;
  priority: number;
  reason: string;
  confidence: NbaConfidence;
  riskLevel: RiskLevel;
  revenueAtRisk: number | null;
  generatedAt: string;
}

const ACTION_RANK: Record<NextBestAction, number> = {
  RESPOND_TO_CUSTOMER: 1,
  CONFIRM_SITE_VISIT: 2,
  FOLLOW_UP_AFTER_SITE_VISIT: 3,
  BOOK_SITE_VISIT: 4,
  FOLLOW_UP: 5,
  ESCALATE_TO_MANAGER: 6,
  HANDOFF_TO_HUMAN: 6,
  REACTIVATE_LEAD: 7,
  FIND_BETTER_PROPERTY: 8,
  WAIT_AND_MONITOR: 9,
  NO_ACTION: 10,
};

function wholeDays(hours: number): number {
  return Math.max(1, Math.floor(hours / 24));
}

function agoPhrase(hours: number): string {
  if (hours < 1) return "minutes ago";
  if (hours < 24) {
    const h = Math.max(1, Math.round(hours));
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = wholeDays(hours);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Deterministic 0–100 urgency-first score. Value nudges, never dominates. */
export function scoreActionPriority(
  action: NextBestAction,
  input: Pick<
    NbaInput,
    "riskScore" | "leadScore" | "hasValue" | "lastInboundHoursAgo" | "overdueFollowUpCount" | "upcomingVisitInHours" | "riskLevel"
  >
): number {
  let score = 0;
  const inbound = input.lastInboundHoursAgo;
  if (inbound != null) {
    if (inbound < 6) score += 25;
    else if (inbound < 24) score += 15;
    else if (inbound < 72) score += 8;
  }
  if (input.upcomingVisitInHours != null) {
    if (input.upcomingVisitInHours <= 24) score += 20;
    else if (input.upcomingVisitInHours <= 48) score += 12;
  }
  score += Math.min(20, 10 + Math.max(0, input.overdueFollowUpCount - 1) * 4);
  if (action === "FOLLOW_UP_AFTER_SITE_VISIT") score += 10;
  if (action === "REACTIVATE_LEAD") score += 8;
  score += Math.round(input.riskScore * 0.3);
  if (input.hasValue) score += 8;
  if (input.riskLevel === "CRITICAL") score += 5;
  if (action === "WAIT_AND_MONITOR" || action === "NO_ACTION") score = Math.min(score, 20);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Pure, deterministic recommendation. All time flows in via the input. */
export function recommendNextBestAction(input: NbaInput, nowMs: number = Date.now()): NextBestActionResult {
  const generatedAt = new Date(nowMs).toISOString();
  const base = {
    leadId: input.leadId,
    leadName: input.leadName ?? null,
    riskLevel: input.riskLevel,
    revenueAtRisk: input.revenueAtRisk ?? null,
    generatedAt,
  };
  const inbound = input.lastInboundHoursAgo;
  const unansweredInbound =
    inbound != null &&
    inbound <= 24 * 7 &&
    (input.lastOutboundHoursAgo == null || input.lastOutboundHoursAgo > inbound);

  const pick = (
    action: NextBestAction,
    reason: string,
    confidence: NbaConfidence
  ): NextBestActionResult => ({
    ...base,
    action,
    priority: scoreActionPriority(action, input),
    reason,
    confidence,
  });

  // Closed / opted out: never act.
  if (["CONVERTED", "LOST"].includes(input.status)) {
    return pick("NO_ACTION", "Lead is closed — no further action.", "HIGH");
  }
  if (input.optedOut) {
    return pick("NO_ACTION", "Lead opted out — no further action.", "HIGH");
  }

  // 1. Customer waiting for a response.
  if (unansweredInbound && inbound != null && inbound < 72) {
    return pick(
      "RESPOND_TO_CUSTOMER",
      `Customer sent a message ${agoPhrase(inbound)} and no agent response is recorded.`,
      "HIGH"
    );
  }

  // 2. Unconfirmed visit within 48h (including slightly overdue same-day).
  if (
    input.upcomingVisitInHours != null &&
    !input.upcomingVisitConfirmed &&
    input.upcomingVisitInHours <= 48 &&
    input.upcomingVisitInHours >= -24
  ) {
    const when =
      input.upcomingVisitInHours < 0
        ? "earlier today"
        : input.upcomingVisitInHours <= 24
          ? "within the next 24 hours"
          : "within the next 48 hours";
    return pick(
      "CONFIRM_SITE_VISIT",
      `Site visit is scheduled ${when} and confirmation has not been recorded.`,
      "HIGH"
    );
  }

  // 3. Completed visit, silence after.
  if (input.completedVisitWithoutFollowUp) {
    return pick(
      "FOLLOW_UP_AFTER_SITE_VISIT",
      "Site visit completed but no follow-up contact is recorded afterward.",
      "HIGH"
    );
  }

  // 4. Qualified + wants a visit + nothing on the books.
  if (input.qualifiedForVisit && input.siteVisitInterest && !input.hasAnyAppointment) {
    return pick(
      "BOOK_SITE_VISIT",
      "Qualified lead wants a site visit and none is scheduled.",
      "MEDIUM"
    );
  }

  // 5. Recovery mapping (recovery already applied cooldowns/anti-spam).
  if (input.recoveryShouldAct && input.recoveryAction) {
    switch (input.recoveryAction) {
      case "FOLLOW_UP":
        return pick("FOLLOW_UP", `Overdue follow-up needs action. ${input.riskReasons[0] ?? ""}`.trim(), "MEDIUM");
      case "REACTIVATION":
        return pick("REACTIVATE_LEAD", `Dormant lead with intent. ${input.riskReasons[0] ?? ""}`.trim(), "MEDIUM");
      case "MANAGER_ESCALATION":
        return pick("ESCALATE_TO_MANAGER", `Repeated overdue follow-ups need a manager. ${input.riskReasons[0] ?? ""}`.trim(), "HIGH");
      case "HUMAN_HANDOFF":
        return pick("HANDOFF_TO_HUMAN", "Conversation is waiting for a human takeover.", "HIGH");
      case "SITE_VISIT_RECOVERY":
        return pick("BOOK_SITE_VISIT", "Site-visit situation needs an agent to schedule or reschedule.", "MEDIUM");
      case "AGENT_ALERT":
        if (unansweredInbound) {
          return pick("RESPOND_TO_CUSTOMER", "Agent attention needed: customer message is waiting.", "MEDIUM");
        }
        if (input.riskLevel === "CRITICAL") {
          return pick("ESCALATE_TO_MANAGER", "Critical-risk lead needs a human owner.", "MEDIUM");
        }
        return pick("FOLLOW_UP", "Owner nudge: check in with this lead.", "LOW");
    }
  }

  // 6. Interest exists but nothing fits the inventory.
  if (input.hasAnyInterest && !input.hasStrongMatch && input.riskLevel !== "LOW") {
    return pick(
      "FIND_BETTER_PROPERTY",
      "Lead has property interest but no strong inventory match — source or adjust options.",
      "MEDIUM"
    );
  }

  // 7. Dormant high-intent lead with value.
  if (
    (inbound == null || inbound > 24 * 14) &&
    input.leadScore >= 60 &&
    input.hasValue &&
    input.riskLevel !== "LOW"
  ) {
    return pick("REACTIVATE_LEAD", "Dormant lead with strong qualification and value on file.", "MEDIUM");
  }

  // 8. Active queue: monitor, don't stack work.
  if (input.pendingFollowUp || input.daysSinceLastAutoOutreach != null) {
    return pick("WAIT_AND_MONITOR", "Outreach is already in flight — monitor before acting again.", "MEDIUM");
  }

  // 9. Fallback.
  if (input.riskLevel === "LOW") {
    return pick("NO_ACTION", "Lead is healthy — no action needed.", "HIGH");
  }
  return pick("WAIT_AND_MONITOR", "Weak signals only — monitor before acting.", "LOW");
}

export interface NbaOrgResult {
  evaluated: number;
  actions: NextBestActionResult[];
  calculatedAt: string;
}

/**
 * Organization-wide recommendations. Consumption-only layering: risk scores
 * come from getOrganizationRevenueRisk, cooldown/duplicate semantics from
 * evaluateRecoveryDecision inputs, appointment + match signals from bounded
 * org-scoped queries (≈8 batched queries, no per-lead N+1).
 */
export async function getOrganizationNextBestActions(
  organizationId: string,
  opts: { now?: Date | number; assignedAgentId?: string | null; limit?: number } = {}
): Promise<NbaOrgResult> {
  const nowMs = opts.now == null ? Date.now() : typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const calculatedAt = new Date(nowMs).toISOString();
  const limit = opts.limit ?? 15;

  const risk = await getOrganizationRevenueRisk(
    organizationId,
    opts.assignedAgentId !== undefined
      ? { now: nowMs, assignedAgentId: opts.assignedAgentId, topLimit: 200, includeAll: true }
      : { now: nowMs, topLimit: 200, includeAll: true }
  );

  // Evaluate at-risk leads plus healthy leads that show activity (a thread,
  // a follow-up, or an appointment makes an action possible). Purely quiet
  // LOW leads resolve to NO_ACTION without any message reads. Bounded: the
  // at-risk set first, then at most 100 active-healthy leads.
  const MAX_EVALUATED = 150;
  const activeLeadIds = new Set<string>();
  const convLeadIds = new Set<string>();
  const fuLeadIds = new Set<string>();
  const apptLeadIds = new Set<string>();
  const [leadRows, convRows, fuRows, apptRows, taskRows] = await Promise.all([
    db.select().from(leads).where(eq(leads.organizationId, organizationId)),
    db.select().from(conversations).where(eq(conversations.organizationId, organizationId)),
    db.select().from(followUps).where(eq(followUps.organizationId, organizationId)),
    db.select().from(appointments).where(eq(appointments.organizationId, organizationId)),
    db.select({ leadId: tasks.leadId }).from(tasks).where(
      and(eq(tasks.organizationId, organizationId), eq(tasks.isDone, false))
    ),
  ]);
  for (const c of convRows) convLeadIds.add(c.leadId);
  for (const f of fuRows) fuLeadIds.add(f.leadId);
  for (const a of apptRows) apptLeadIds.add(a.leadId);
  const visibleLeadIds = new Set(
    opts.assignedAgentId !== undefined
      ? leadRows.filter((l) => !l.assignedAgentId || l.assignedAgentId === opts.assignedAgentId).map((l) => l.id)
      : leadRows.map((l) => l.id)
  );
  const evalItems: LeadRiskResult[] = [];
  for (const item of risk.allRisks) {
    if (!visibleLeadIds.has(item.leadId)) continue;
    if (item.riskLevel !== "LOW") {
      evalItems.push(item);
      activeLeadIds.add(item.leadId);
    }
  }
  if (evalItems.length < MAX_EVALUATED) {
    for (const item of risk.allRisks) {
      if (evalItems.length >= MAX_EVALUATED) break;
      if (activeLeadIds.has(item.leadId)) continue;
      if (!visibleLeadIds.has(item.leadId)) continue;
      if (convLeadIds.has(item.leadId) || fuLeadIds.has(item.leadId) || apptLeadIds.has(item.leadId)) {
        evalItems.push(item);
        activeLeadIds.add(item.leadId);
      }
    }
  }
  if (evalItems.length === 0) {
    return { evaluated: risk.evaluatedLeads, actions: [], calculatedAt };
  }
  // Phase 2 (bounded): interests + latest-thread messages for the evaluated
  // set only — two inArray queries, never table-wide, never per-lead N+1.
  const evalIds = Array.from(new Set(evalItems.map((r) => r.leadId)));
  const latestConvByLead = new Map<string, string>();
  for (const item of evalItems) {
    const convs = convRows.filter((c) => c.leadId === item.leadId);
    const latest = convs.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    if (latest) latestConvByLead.set(item.leadId, latest.id);
  }
  const evalConvIds = Array.from(latestConvByLead.values());
  const [evalInterests, evalMessages] = await Promise.all([
    db.select().from(leadPropertyInterests).where(inArray(leadPropertyInterests.leadId, evalIds)),
    evalConvIds.length > 0
      ? db
          .select({ conversationId: messages.conversationId, sender: messages.sender, createdAt: messages.createdAt })
          .from(messages)
          .where(inArray(messages.conversationId, evalConvIds))
      : Promise.resolve([] as { conversationId: string; sender: "LEAD" | "AI" | "AGENT" | "SYSTEM"; createdAt: string }[]),
  ]);
  const messagesByConv = new Map<string, typeof evalMessages>();
  for (const m of evalMessages) {
    const list = messagesByConv.get(m.conversationId) ?? [];
    list.push(m);
    messagesByConv.set(m.conversationId, list);
  }
  const leadById = new Map(leadRows.map((l) => [l.id, l]));
  const openTaskByLead = new Set(taskRows.map((t) => t.leadId).filter((v): v is string => v != null));

  const results: NextBestActionResult[] = [];
  for (const item of evalItems) {
    const lead = leadById.get(item.leadId);
    if (!lead) continue;
    const latestConvId = latestConvByLead.get(item.leadId) ?? null;
    const latestConv = latestConvId ? convRows.find((c) => c.id === latestConvId) ?? null : null;
    const leadMessages = [...(latestConvId ? (messagesByConv.get(latestConvId) ?? []) : [])]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20);
    const toHours = (iso: string | null) => (iso ? (nowMs - new Date(iso).getTime()) / 3_600_000 : null);
    const inboundMsg = leadMessages.find((x) => x.sender === "LEAD") ?? null;
    const outboundMsg = leadMessages.find((x) => x.sender === "AI" || x.sender === "AGENT") ?? null;
    const inboundH = inboundMsg ? toHours(inboundMsg.createdAt) : toHours(item.lastInteractionAt);
    const leadFus = fuRows.filter((f) => f.leadId === lead.id);
    const pendingFu = leadFus.some((f) => f.status === "PENDING");
    const pastDuePending = leadFus.filter((f) => f.status === "PENDING" && f.scheduledFor <= item.calculatedAt);
    const failedSends = leadFus.filter((f) => f.status === "FAILED");
    const overdueCount = pastDuePending.length + failedSends.length;
    const overdueAges = [
      ...pastDuePending.map((f) => (nowMs - new Date(f.scheduledFor).getTime()) / 3_600_000),
      ...failedSends.map((f) => (nowMs - new Date(f.createdAt).getTime()) / 3_600_000),
    ];
    const sentTimes = leadFus.filter((f) => f.status === "SENT" && f.sentAt != null).map((f) => new Date(f.sentAt as string).getTime());
    const leadAppts = apptRows.filter((a) => a.leadId === lead.id);
    const upcomingSiteVisits = leadAppts.filter(
      (a) => a.type === "SITE_VISIT" && ["SCHEDULED", "CONFIRMED"].includes(a.status)
    );
    const nextVisit = upcomingSiteVisits
      .map((a) => (new Date(a.scheduledAt).getTime() - nowMs) / 3_600_000)
      .filter((h) => h >= -24)
      .sort((x, y) => x - y)[0] ?? null;
    const nextVisitConfirmed = upcomingSiteVisits.some(
      (a) => a.status === "CONFIRMED" && (new Date(a.scheduledAt).getTime() - nowMs) / 3_600_000 === nextVisit
    );
    const completedVisits = leadAppts.filter((a) => a.type === "SITE_VISIT" && a.status === "COMPLETED");
    const lastCompletion = completedVisits.length > 0 ? Math.max(...completedVisits.map((a) => new Date(a.scheduledAt).getTime())) : null;
    const contactAfterCompletion =
      lastCompletion == null
        ? false
        : leadMessages.some((m) => new Date(m.createdAt).getTime() > lastCompletion) ||
          leadFus.some((f) => f.status === "SENT" && f.sentAt != null && new Date(f.sentAt).getTime() > lastCompletion);
    const hasAnyAppt = leadAppts.some((a) => !["CANCELED"].includes(a.status));
    const interests = evalInterests.filter((i) => i.leadId === lead.id);
    const recovery = evaluateRecoveryDecision(
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
        lastOutboundHoursAgo: outboundMsg ? toHours(outboundMsg.createdAt) : null,
        followUpOverdue: item.followUpStatus === "OVERDUE",
        overdueFollowUpCount: overdueCount,
        mostOverdueHoursAgo: overdueAges.length > 0 ? Math.max(...overdueAges) : null,
        hasUpcomingAppointment: leadAppts.some((a) => ["SCHEDULED", "CONFIRMED"].includes(a.status) && a.scheduledAt >= item.calculatedAt),
        hasMissedVisit: leadAppts.some((a) => a.status === "NO_SHOW"),
        siteVisitInterest: lead.siteVisitInterest,
        handoffAwaitingHuman: latestConv?.status === "HUMAN_HANDLING",
        assignedAgentId: lead.assignedAgentId,
        channel: latestConv?.channel ?? "WEBSITE_CHAT",
        pendingFollowUp: pendingFu,
        daysSinceLastAutoOutreach: sentTimes.length === 0 ? null : (nowMs - Math.max(...sentTimes)) / 86_400_000,
        openTaskExists: openTaskByLead.has(lead.id),
      },
      nowMs
    );

    const result = recommendNextBestAction(
      {
        leadId: lead.id,
        leadName: lead.name,
        status: lead.status,
        optedOut: lead.optedOut,
        leadScore: item.leadScore,
        riskLevel: item.riskLevel,
        riskScore: item.riskScore,
        riskReasons: item.reasons,
        revenueAtRisk: item.revenueAtRisk,
        hasValue: item.revenueAtRisk != null || item.propertyValue != null,
        lastInboundHoursAgo: inboundH,
        lastOutboundHoursAgo: outboundMsg ? toHours(outboundMsg.createdAt) : null,
        followUpOverdue: item.followUpStatus === "OVERDUE",
        overdueFollowUpCount: overdueCount,
        pendingFollowUp: pendingFu,
        daysSinceLastAutoOutreach: sentTimes.length === 0 ? null : (nowMs - Math.max(...sentTimes)) / 86_400_000,
        openTaskExists: openTaskByLead.has(lead.id),
        upcomingVisitInHours: nextVisit,
        upcomingVisitConfirmed: nextVisitConfirmed,
        completedVisitWithoutFollowUp: lastCompletion != null && !contactAfterCompletion,
        hasAnyAppointment: hasAnyAppt,
        siteVisitInterest: lead.siteVisitInterest,
        qualifiedForVisit: item.leadScore >= 60 || ["QUALIFIED", "INTERESTED", "NEGOTIATION"].includes(lead.status),
        hasStrongMatch: interests.some((i) => i.matchType === "EXACT" || i.matchType === "CLOSE"),
        hasAnyInterest: interests.length > 0,
        handoffAwaitingHuman: latestConv?.status === "HUMAN_HANDLING",
        assignedAgentId: lead.assignedAgentId,
        channel: latestConv?.channel ?? "WEBSITE_CHAT",
        recoveryAction: recovery.shouldRecover ? recovery.actionType : null,
        recoveryShouldAct: recovery.shouldRecover,
      },
      nowMs
    );
    results.push(result);
  }

  results.sort(
    (a, b) => b.priority - a.priority || ACTION_RANK[a.action] - ACTION_RANK[b.action] || (a.leadId < b.leadId ? -1 : 1)
  );
  return { evaluated: evalItems.length, actions: results.slice(0, limit), calculatedAt };
}
