import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  auditLogs,
  conversations,
  followUps,
  leadPropertyInterests,
  leadScoreEvents,
  leads,
  messages,
  tasks,
  users,
} from "@/db/schema";
import {
  getOrganizationRevenueRisk,
  type RiskLevel,
} from "./revenue-at-risk";
import {
  RECOVERY_COOLDOWN_DAYS,
  evaluateRecoveryDecision,
} from "./recovery-engine";
import {
  recommendNextBestAction,
  type NextBestAction,
} from "./next-best-action";

/**
 * REVENUE RECOVERY AUTOPILOT (Batch 8, V1).
 *
 * A deterministic read-and-recommend layer over the existing engines. It
 * performs NO scoring of its own where an engine already owns the question:
 * - money anchors come from getOrganizationRevenueRisk (property midpoint
 *   else budgetMaxInr else null — never invented),
 * - send/cooldown/duplicate semantics come from evaluateRecoveryDecision,
 * - the single recommended action comes from recommendNextBestAction.
 *
 * What this module ADDS (and only this):
 * - leak detection across 9 named categories with factual evidence,
 * - an explainable urgency-first priority (value nudges, never dominates),
 * - a factual per-lead recovery timeline built from existing rows only,
 * - deterministic outcome tracking (attempt vs success vs revenue),
 * - lost/won deal explanation frameworks with explicitly non-causal wording,
 * - audit-trail backed execute/dismiss markers (existing audit_logs table).
 *
 * HONESTY RULES (load-bearing):
 * - recoveredRevenue is ALWAYS null. There is no payment/collection evidence
 *   anywhere in the schema, so no realized-revenue number is derived — not
 *   from CONVERTED status, not from visits, not from sends.
 * - A recovery ATTEMPT (task/follow-up/alert created) is never a SUCCESS.
 * - A SUCCESS (customer responded / appointment created / visit completed
 *   after the attempt) is never REVENUE.
 * - Timelines contain only rows that exist. No backfilled history.
 * - Lost-deal wording is "observed" / "potential contributing factor" /
 *   "based on recorded activity" — never "caused".
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RevenueLeakType =
  | "UNANSWERED_HIGH_INTENT"
  | "FOLLOW_UP_OVERDUE"
  | "SITE_VISIT_NOT_CONFIRMED"
  | "SITE_VISIT_NO_FOLLOW_UP"
  | "DORMANT_HIGH_VALUE"
  | "PROPERTY_MISMATCH"
  | "AGENT_SLA_BREACH"
  | "HIGH_RISK_DEAL"
  | "HUMAN_HANDOFF_REQUIRED";

/** Human must approve. PREPARE = draft/task staged, not sent. AUTO = the
 *  existing follow-up pipeline only (already opt-out/closed/max-attempt
 *  guarded). Customer-facing sends are never introduced here. */
export type AutopilotAutomation = "RECOMMEND" | "PREPARE" | "AUTO";

export type LeakRecoveryStatus =
  | "ACTION_NEEDED"
  | "IN_PROGRESS"
  | "DISMISSED"
  | "MONITORING";

/** Everything detection needs, derived from stored rows by the caller.
 *  Pure input — unit-testable without a database. */
export interface LeakSignal {
  leadId: string;
  leadName?: string | null;
  status: string;
  optedOut?: boolean;
  leadScore: number;
  temperature?: string | null;
  siteVisitInterest?: boolean | null;
  riskLevel: RiskLevel;
  riskScore: number;
  riskReasons: string[];
  /** Verified anchor only: property midpoint else budgetMaxInr else null. */
  opportunityValue: number | null;
  revenueAtRisk: number | null;
  hasValue: boolean;
  lastInboundHoursAgo: number | null;
  lastOutboundHoursAgo: number | null;
  inboundCount?: number | null;
  leadAgeHoursAgo?: number | null;
  followUpOverdue: boolean;
  overdueFollowUpCount: number;
  mostOverdueHoursAgo?: number | null;
  pendingFollowUp: boolean;
  daysSinceLastAutoOutreach: number | null;
  openTaskExists: boolean;
  upcomingVisitInHours: number | null;
  upcomingVisitConfirmed: boolean;
  hasUpcomingAppointment: boolean;
  completedVisitWithoutFollowUp: boolean;
  hasAnyAppointment: boolean;
  hasStrongMatch: boolean;
  hasAnyInterest: boolean;
  qualifiedForVisit: boolean;
  handoffAwaitingHuman: boolean;
  assignedAgentId?: string | null;
  channel: string;
}

export interface DetectedLeak {
  type: RevenueLeakType;
  title: string;
  reason: string;
  evidence: string[];
}

export interface ScoredLeak extends DetectedLeak {
  leakId: string;
  leadId: string;
  leadName: string | null;
  stage: string;
  riskLevel: RiskLevel;
  riskScore: number;
  opportunityValue: number | null;
  revenueAtRisk: number | null;
  priority: number;
  priorityBreakdown: string[];
  recommendedAction: NextBestAction;
  recommendedReason: string;
  automation: AutopilotAutomation;
  executionGuidance: string;
  ownerAgentId: string | null;
  ownerAgentName: string | null;
  hoursSinceLastAction: number | null;
  recoveryStatus: LeakRecoveryStatus;
  statusDetail: string | null;
  cooldownUntil: string | null;
}

export interface LeadOutcome {
  leadId: string;
  leadName: string | null;
  /** Recovery ATTEMPTS observed (tasks/follow-ups/alerts on record). */
  attempts: number;
  attemptsDetail: string[];
  customerRespondedAfterAttempt: boolean;
  appointmentCreatedAfterAttempt: boolean;
  visitCompletedAfterAttempt: boolean;
  currentStatus: string;
  /** SUCCESS = responded/appointed/visited after an attempt. Never revenue. */
  positiveOutcome: boolean;
  /** Furthest-evidenced lifecycle milestone (§11) — never inferred. */
  recoveryState: RecoveryState;
  stateEvidence: string;
  /** CONFIRMED_RESPONSE only with post-attempt response evidence; else the
   *  honest "not yet confirmed" label (§12). */
  confirmationStatus: "CONFIRMED_RESPONSE" | "OUTCOME_NOT_YET_CONFIRMED";
  confirmationLabel: string;
  revenueNote: string;
}

export interface ClosedDealAnalysis {
  leadId: string;
  leadName: string | null;
  status: "LOST" | "CONVERTED";
  /** Associated transaction value on file — not a loss figure, not profit. */
  associatedValue: number | null;
  observed: string[];
  /** Lost only. Explicitly non-causal wording. */
  potentialContributingFactors: string[];
  /** Won only. Repeatable workflow signals, factually stated. */
  conversionSignals: string[];
  honestyNote: string;
}

export interface TimelineEvent {
  at: string;
  kind: string;
  title: string;
  detail: string;
  source: string;
}

export interface AutopilotOverview {
  trackedOpportunity: number;
  revenueAtRisk: number;
  activeLeaks: number;
  criticalLeaks: number;
  highPriorityActions: number;
  recoveryAttempts: number;
  positiveOutcomes: number;
  /** Outcomes with an inbound customer message after the attempt (§12). */
  recoveryResponses: number;
  /** Appointments created after the attempt (timestamp association). */
  appointmentsRecovered: number;
  /** Site visits completed after the attempt (association, not causation). */
  siteVisitsRecovered: number;
  /** Closed leads with recovery activity on record, by status (association
   *  only — the schema records no status-change timestamps, so no causal or
   *  ordering claim is made). */
  dealsWonWithActivity: number;
  dealsLostWithActivity: number;
  /** ALWAYS null — see honesty rules. Present so UIs cannot misread. */
  recoveredRevenue: null;
  honestyNote: string;
}

export interface RecoveryAutopilot {
  calculatedAt: string;
  scopedToAgentId: string | null;
  overview: AutopilotOverview;
  leaks: ScoredLeak[];
  outcomes: LeadOutcome[];
  lostDeals: ClosedDealAnalysis[];
  wonDeals: ClosedDealAnalysis[];
}

export const RECOVERED_REVENUE_HONESTY_NOTE =
  "Recovered revenue requires confirmed payment/collection evidence, which Basera does not record. Follow-ups, tasks, visits, and responses below are recovery activity — not collected revenue. No recovered-revenue figure is shown or implied.";

export const RECOVERY_ACTIVITY_LABEL =
  "Recovery activity (based on recorded rows — attempts and responses, never revenue).";

/** Shown whenever recovery evidence is insufficient for a confirmed outcome (§12). */
export const OUTCOME_NOT_YET_CONFIRMED_LABEL = "Recovery outcome not yet confirmed";

// ---------------------------------------------------------------------------
// Deterministic thresholds (documented, no LLM, no learning)
// ---------------------------------------------------------------------------

/** High-intent inbound unanswered beyond this is a leak (hours). */
const RESPONSE_SLA_HIGH_INTENT_HOURS = 12;
/** Any other inbound unanswered beyond this is a leak (hours). */
const RESPONSE_SLA_STANDARD_HOURS = 24;
/** Assigned owner must act within this window (hours). */
const AGENT_SLA_HOURS = 24;
/** Unconfirmed visit inside this window is at risk (hours, mirrors NBA). */
const VISIT_CONFIRM_WINDOW_HOURS = 48;
/** Quiet + valuable + qualified beyond this is dormant (hours). */
const DORMANT_HOURS = 14 * 24;
/** Inbound older than this is dormancy, not "unanswered" (hours). */
const UNANSWERED_MAX_AGE_HOURS = 7 * 24;
/** Recent human dismissal suppresses re-nudging for this long (days). */
export const DISMISS_SUPPRESSION_DAYS = 14;
/** Duplicate execute protection window on top of engine cooldowns (hours). */
export const EXECUTE_IDEMPOTENCY_HOURS = 24;

const CLOSED_STATUSES = ["CONVERTED", "LOST"];

const LEAK_TITLES: Record<RevenueLeakType, string> = {
  UNANSWERED_HIGH_INTENT: "Unanswered high-intent lead",
  FOLLOW_UP_OVERDUE: "Follow-up overdue",
  SITE_VISIT_NOT_CONFIRMED: "Site visit not confirmed",
  SITE_VISIT_NO_FOLLOW_UP: "No follow-up after site visit",
  DORMANT_HIGH_VALUE: "Dormant high-value lead",
  PROPERTY_MISMATCH: "Weak property match",
  AGENT_SLA_BREACH: "Agent response SLA breach",
  HIGH_RISK_DEAL: "High-risk deal needs an owner",
  HUMAN_HANDOFF_REQUIRED: "Human handoff required",
};

function wholeDays(hours: number): number {
  return Math.max(1, Math.floor(hours / 24));
}

function agoPhrase(hours: number): string {
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) {
    const h = Math.max(1, Math.round(hours));
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = wholeDays(hours);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

// ---------------------------------------------------------------------------
// Pure: opportunity value (reuse of the at-risk anchor rule, no invention)
// ---------------------------------------------------------------------------

/** Verified property midpoint else budgetMaxInr else null. Never invented. */
export function opportunityValueFor(
  propertyMidpoint: number | null | undefined,
  budgetMaxInr: number | null | undefined
): number | null {
  if (propertyMidpoint != null && propertyMidpoint > 0) return propertyMidpoint;
  if (budgetMaxInr != null && budgetMaxInr > 0) return budgetMaxInr;
  return null;
}

// ---------------------------------------------------------------------------
// Pure: leak detection (deterministic, evidence-backed, no fake categories)
// ---------------------------------------------------------------------------

function isHighIntent(signal: LeakSignal): boolean {
  return (
    signal.leadScore >= 60 ||
    signal.temperature === "HOT" ||
    signal.siteVisitInterest === true ||
    signal.riskLevel === "HIGH" ||
    signal.riskLevel === "CRITICAL"
  );
}

function unansweredInbound(signal: LeakSignal): boolean {
  const inbound = signal.lastInboundHoursAgo;
  if (inbound == null) return false;
  return signal.lastOutboundHoursAgo == null || signal.lastOutboundHoursAgo > inbound;
}

/** Pure, deterministic detection. Guards first: closed/opted-out leads never
 *  leak. Risk-gated categories (intent/dormancy/mismatch/SLA/fallback) need
 *  risk above LOW so counts are never inflated; row-factual categories
 *  (overdue follow-up, unconfirmed visit, post-visit silence, handoff) fire
 *  on the underlying rows alone — exactly like the NBA engine, which
 *  recommends CONFIRM_SITE_VISIT regardless of risk level. HIGH_RISK_DEAL
 *  fires only as a fallback so it can never inflate counts. */
export function detectLeaks(signal: LeakSignal, nowMs: number = Date.now()): DetectedLeak[] {
  void nowMs;
  if (CLOSED_STATUSES.includes(signal.status)) return [];
  if (signal.optedOut) return [];
  const elevated = signal.riskLevel !== "LOW";

  const found: DetectedLeak[] = [];
  const inbound = signal.lastInboundHoursAgo;

  // A. Unanswered high-intent lead (response SLA breach). Risk-gated: only
  // meaningful intent/value becomes a leak.
  if (elevated && inbound != null && unansweredInbound(signal) && isHighIntent(signal)) {
    const sla = signal.leadScore >= 60 || signal.temperature === "HOT" || signal.siteVisitInterest === true
      ? RESPONSE_SLA_HIGH_INTENT_HOURS
      : RESPONSE_SLA_STANDARD_HOURS;
    if (inbound > sla && inbound <= UNANSWERED_MAX_AGE_HOURS) {
      found.push({
        type: "UNANSWERED_HIGH_INTENT",
        title: LEAK_TITLES.UNANSWERED_HIGH_INTENT,
        reason: `High-intent customer message from ${agoPhrase(inbound)} has no recorded agent response (response SLA is ${sla}h).`,
        evidence: [
          `Last customer message: ${agoPhrase(inbound)}.`,
          signal.lastOutboundHoursAgo == null
            ? "Last agent response: none recorded."
            : `Last agent response: ${agoPhrase(signal.lastOutboundHoursAgo)} (before the customer message).`,
          `Lead score: ${signal.leadScore}/100${signal.temperature ? ` · ${signal.temperature}` : ""}.`,
        ],
      });
    }
  }

  // B. Follow-up overdue.
  if (signal.followUpOverdue || signal.overdueFollowUpCount > 0) {
    const n = Math.max(signal.overdueFollowUpCount, 1);
    found.push({
      type: "FOLLOW_UP_OVERDUE",
      title: LEAK_TITLES.FOLLOW_UP_OVERDUE,
      reason:
        n === 1
          ? "A follow-up is past its scheduled time with no recorded completion."
          : `${n} follow-ups are past their scheduled times with no recorded completion.`,
      evidence: [
        signal.mostOverdueHoursAgo != null
          ? `Most overdue by ${agoPhrase(signal.mostOverdueHoursAgo).replace(" ago", "")} past schedule.`
          : "Scheduled follow-up time has passed.",
        inbound != null ? `Last customer message: ${agoPhrase(inbound)}.` : "No customer message on record.",
      ],
    });
  }

  // C. Site visit not confirmed (risk before the visit; mirrors NBA window).
  if (
    signal.upcomingVisitInHours != null &&
    !signal.upcomingVisitConfirmed &&
    signal.upcomingVisitInHours <= VISIT_CONFIRM_WINDOW_HOURS &&
    signal.upcomingVisitInHours >= -24
  ) {
    const when =
      signal.upcomingVisitInHours < 0
        ? "earlier today"
        : signal.upcomingVisitInHours <= 24
          ? "within the next 24 hours"
          : "within the next 48 hours";
    found.push({
      type: "SITE_VISIT_NOT_CONFIRMED",
      title: LEAK_TITLES.SITE_VISIT_NOT_CONFIRMED,
      reason: `Site visit is scheduled ${when} and confirmation has not been recorded.`,
      evidence: [
        `Visit timing: ${when} (recorded appointment row).`,
        "Appointment status: scheduled, not confirmed.",
      ],
    });
  }

  // D. Site visit completed with no post-visit follow-up.
  if (signal.completedVisitWithoutFollowUp) {
    found.push({
      type: "SITE_VISIT_NO_FOLLOW_UP",
      title: LEAK_TITLES.SITE_VISIT_NO_FOLLOW_UP,
      reason: "Site visit is recorded as completed but no follow-up contact is recorded afterward.",
      evidence: [
        "Completed site-visit appointment on record.",
        "No outbound message or sent follow-up recorded after completion.",
      ],
    });
  }

  // E. Dormant high-value lead. Risk-gated by construction (value + score).
  const dormant = inbound == null || inbound > DORMANT_HOURS;
  if (elevated && dormant && signal.hasValue && signal.leadScore >= 60) {
    found.push({
      type: "DORMANT_HIGH_VALUE",
      title: LEAK_TITLES.DORMANT_HIGH_VALUE,
      reason:
        inbound == null
          ? `Qualified lead (score ${signal.leadScore}/100) with value on file has no recorded customer message and has gone quiet.`
          : `Qualified lead (score ${signal.leadScore}/100) with value on file has been inactive for ${wholeDays(inbound)} days.`,
      evidence: [
        `Lead score: ${signal.leadScore}/100.`,
        signal.opportunityValue != null
          ? `Opportunity value on file: ₹${signal.opportunityValue.toLocaleString("en-IN")}.`
          : "Value anchor on file (property or budget).",
        inbound == null ? "No inbound message on record." : `Last customer message: ${agoPhrase(inbound)}.`,
      ],
    });
  }

  // F. Property mismatch — uses the existing verified matching output
  // (leadPropertyInterests rows). Never invents properties. Risk-gated so a
  // weak match alone on a healthy lead is not counted as leaking revenue.
  if (elevated && signal.hasAnyInterest && !signal.hasStrongMatch && signal.qualifiedForVisit) {
    found.push({
      type: "PROPERTY_MISMATCH",
      title: LEAK_TITLES.PROPERTY_MISMATCH,
      reason: "Lead has recorded property interest but no strong (exact/close) inventory match — the current recommendation is weak.",
      evidence: [
        "Property interest rows exist for this lead.",
        "No interest row with a strong exact/close match type.",
        "Source: existing verified property-matching output.",
      ],
    });
  }

  // G. Agent SLA breach — an assigned owner has not acted in time.
  // Risk-gated: a LOW-risk lead arguably requires no action.
  if (elevated && signal.assignedAgentId) {
    const inboundBreach =
      inbound != null && inbound > AGENT_SLA_HOURS && unansweredInbound(signal) && inbound <= UNANSWERED_MAX_AGE_HOURS;
    const overdueBreach =
      signal.overdueFollowUpCount > 0 &&
      (signal.mostOverdueHoursAgo ?? 0) > AGENT_SLA_HOURS;
    if (inboundBreach || overdueBreach) {
      found.push({
        type: "AGENT_SLA_BREACH",
        title: LEAK_TITLES.AGENT_SLA_BREACH,
        reason: overdueBreach
          ? `Assigned agent has an overdue follow-up (${agoPhrase(signal.mostOverdueHoursAgo ?? AGENT_SLA_HOURS + 1).replace(" ago", "")} past schedule) with no recorded action.`
          : `Assigned agent has not responded to the customer message from ${agoPhrase(inbound ?? AGENT_SLA_HOURS + 1)} (agent SLA is ${AGENT_SLA_HOURS}h).`,
        evidence: [
          "Lead has an assigned agent on record.",
          inbound != null ? `Last customer message: ${agoPhrase(inbound)}.` : "Overdue follow-up on record.",
          signal.lastOutboundHoursAgo == null
            ? "Last agent response: none recorded."
            : `Last agent response: ${agoPhrase(signal.lastOutboundHoursAgo)}.`,
        ],
      });
    }
  }

  // I. Human handoff required — surface, never automate past it.
  if (signal.handoffAwaitingHuman) {
    found.push({
      type: "HUMAN_HANDOFF_REQUIRED",
      title: LEAK_TITLES.HUMAN_HANDOFF_REQUIRED,
      reason: "Conversation is recorded as waiting for a human takeover — automation must not continue blindly.",
      evidence: ["Conversation status on record: awaiting human."],
    });
  }

  // H. High-risk deal fallback — only when nothing more specific fired, so
  // this category can never inflate counts on top of real leaks.
  if (found.length === 0 && (signal.riskLevel === "HIGH" || signal.riskLevel === "CRITICAL")) {
    found.push({
      type: "HIGH_RISK_DEAL",
      title: LEAK_TITLES.HIGH_RISK_DEAL,
      reason: `Deal shows ${signal.riskLevel.toLowerCase()} revenue risk with no narrower leak category matching — it needs a human owner.`,
      evidence: signal.riskReasons.slice(0, 3),
    });
  }

  return found;
}

// ---------------------------------------------------------------------------
// Pure: explainable urgency-first priority (value nudges, never dominates)
// ---------------------------------------------------------------------------

/** Deterministic 0–100 score. Urgency first, value second: a severe SLA
 *  breach on a smaller opportunity outranks a dormant larger one. Every
 *  contributing point is named in `breakdown`. */
export function scoreLeakPriority(
  signal: LeakSignal,
  type: RevenueLeakType
): { score: number; breakdown: string[] } {
  const breakdown: string[] = [];
  let score = Math.round(signal.riskScore * 0.25);
  breakdown.push(`Base risk contribution: +${score} (risk score ${signal.riskScore}/100 × 0.25).`);

  const inbound = signal.lastInboundHoursAgo;
  if (
    (type === "UNANSWERED_HIGH_INTENT" || type === "AGENT_SLA_BREACH") &&
    inbound != null
  ) {
    if (inbound > 72) { score += 15; breakdown.push("Customer waiting 3+ days: +15."); }
    else if (inbound > 48) { score += 12; breakdown.push("Customer waiting 2+ days: +12."); }
    else if (inbound > 24) { score += 8; breakdown.push("Customer waiting 1+ day: +8."); }
    else if (inbound > 12) { score += 5; breakdown.push("Customer waiting 12+ hours: +5."); }
  }
  if (type === "FOLLOW_UP_OVERDUE") {
    score += 10;
    breakdown.push("Follow-up past schedule: +10.");
    const extra = Math.min(Math.max(signal.overdueFollowUpCount - 1, 0), 2);
    if (extra > 0) {
      score += extra * 4;
      breakdown.push(`Additional overdue follow-ups (${extra}): +${extra * 4}.`);
    }
  }
  if (type === "SITE_VISIT_NOT_CONFIRMED" && signal.upcomingVisitInHours != null) {
    if (signal.upcomingVisitInHours <= 24) { score += 20; breakdown.push("Unconfirmed visit within 24h: +20."); }
    else { score += 12; breakdown.push("Unconfirmed visit within 48h: +12."); }
  }
  if (type === "SITE_VISIT_NO_FOLLOW_UP") {
    score += 10;
    breakdown.push("Completed visit with no recorded follow-up: +10.");
  }
  if (type === "DORMANT_HIGH_VALUE") {
    score += 8;
    breakdown.push("Dormant qualified opportunity: +8.");
  }
  if (type === "PROPERTY_MISMATCH") {
    score += 4;
    breakdown.push("Weak property recommendation: +4.");
  }
  if (type === "HUMAN_HANDOFF_REQUIRED") {
    score += 10;
    breakdown.push("Human takeover waiting: +10.");
  }
  if (type === "HIGH_RISK_DEAL") {
    score += 5;
    breakdown.push("High-risk floor with no narrower category: +5.");
  }
  // Value nudges (small by design — urgency decides, money only tips ties).
  if (signal.hasValue) {
    score += 6;
    breakdown.push("Value on file: +6 (tie-breaker only).");
  }
  if (signal.riskLevel === "CRITICAL") {
    score += 5;
    breakdown.push("Critical risk: +5.");
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), breakdown };
}

export function severityForPriority(score: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 70) return "CRITICAL";
  if (score >= 45) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

/** Lifecycle states a recovery opportunity can occupy (§11). Every state
 *  requires supporting rows — nothing is inferred. */
export type RecoveryState =
  | "OPPORTUNITY_DETECTED"
  | "ACTION_RECOMMENDED"
  | "ACTION_PREPARED"
  | "ACTION_EXECUTED"
  | "CUSTOMER_RESPONDED"
  | "SITE_VISIT_BOOKED"
  | "SITE_VISIT_COMPLETED"
  | "DEAL_PROGRESS"
  | "DEAL_WON"
  | "DEAL_LOST";

export interface RecoveryStateInput {
  currentStatus: string;
  hasAnyLeak: boolean;
  hasActionNeededLeak: boolean;
  /** PREPARE evidence: recovery-titled tasks staged for approval. */
  recoveryTasksStaged: number;
  /** EXECUTED evidence: autopilot execute audit marker for the lead. */
  executeAuditExists: boolean;
  /** EXECUTED evidence: SENT follow-up rows. */
  sentFollowUps: number;
  customerRespondedAfterAttempt: boolean;
  siteVisitBookedAfterAttempt: boolean;
  visitCompletedAfterAttempt: boolean;
}

/** Pipeline stages that count as "deal progress" (current snapshot). */
const RECOVERY_PROGRESS_STATUSES = ["QUALIFIED", "INTERESTED", "SITE_VISIT_SCHEDULED", "NEGOTIATION"];

/**
 * Pure derivation of the furthest-evidenced recovery state. Precedence runs
 * from the most conclusive milestone down; each branch names the rows that
 * support it. In particular a response is NEVER attributed to the recovery
 * ("because recovery worked") — the evidence only states that an inbound
 * message is timestamped after the first attempt.
 */
export function deriveRecoveryState(input: RecoveryStateInput): { state: RecoveryState; stateEvidence: string } {
  const hasAttemptEvidence =
    input.recoveryTasksStaged > 0 || input.sentFollowUps > 0 || input.executeAuditExists;
  if (input.currentStatus === "CONVERTED") {
    return { state: "DEAL_WON", stateEvidence: "Lead status on record: converted (CRM stage — not payment evidence)." };
  }
  if (input.currentStatus === "LOST") {
    return { state: "DEAL_LOST", stateEvidence: "Lead status on record: lost." };
  }
  if (input.visitCompletedAfterAttempt) {
    return { state: "SITE_VISIT_COMPLETED", stateEvidence: "A site-visit appointment recorded as completed is timestamped after the first recovery attempt (association — not proof the recovery caused the visit)." };
  }
  if (input.siteVisitBookedAfterAttempt) {
    return { state: "SITE_VISIT_BOOKED", stateEvidence: "A site-visit appointment created after the first recovery attempt is on record (association — not proven causation)." };
  }
  if (input.customerRespondedAfterAttempt) {
    return { state: "CUSTOMER_RESPONDED", stateEvidence: "An inbound customer message timestamped after the first recovery attempt is on record (association — not proof the recovery caused the reply)." };
  }
  if (hasAttemptEvidence && RECOVERY_PROGRESS_STATUSES.includes(input.currentStatus)) {
    return { state: "DEAL_PROGRESS", stateEvidence: `Recovery attempt(s) on record and the deal currently sits at stage ${input.currentStatus.replace(/_/g, " ").toLowerCase()} (current snapshot).` };
  }
  if (input.executeAuditExists || input.sentFollowUps > 0) {
    return {
      state: "ACTION_EXECUTED",
      stateEvidence: input.executeAuditExists
        ? "An autopilot execute marker is on record for this lead (attempt — not revenue)."
        : "A follow-up recorded as sent exists for this lead (attempt — not revenue).",
    };
  }
  if (input.recoveryTasksStaged > 0) {
    return { state: "ACTION_PREPARED", stateEvidence: "Recovery task(s) staged for human approval with no recorded send (prepared — not executed, not revenue)." };
  }
  if (input.hasActionNeededLeak) {
    return { state: "ACTION_RECOMMENDED", stateEvidence: "A detected leak currently recommends action and no attempt is on record yet." };
  }
  return { state: "OPPORTUNITY_DETECTED", stateEvidence: "A recovery opportunity is detected in the recorded activity; monitoring for action." };
}

/** Fallback recommendation per leak when the NBA engine itself defers
 *  (WAIT_AND_MONITOR/NO_ACTION). The live recommendation always prefers the
 *  actual NBA output — this map is only the tie-break default. */
export function defaultNbaForLeak(type: RevenueLeakType): NextBestAction {
  switch (type) {
    case "UNANSWERED_HIGH_INTENT":
      return "RESPOND_TO_CUSTOMER";
    case "FOLLOW_UP_OVERDUE":
      return "FOLLOW_UP";
    case "SITE_VISIT_NOT_CONFIRMED":
      return "CONFIRM_SITE_VISIT";
    case "SITE_VISIT_NO_FOLLOW_UP":
      return "FOLLOW_UP_AFTER_SITE_VISIT";
    case "DORMANT_HIGH_VALUE":
      return "REACTIVATE_LEAD";
    case "PROPERTY_MISMATCH":
      return "FIND_BETTER_PROPERTY";
    case "AGENT_SLA_BREACH":
      return "FOLLOW_UP";
    case "HUMAN_HANDOFF_REQUIRED":
      return "HANDOFF_TO_HUMAN";
    case "HIGH_RISK_DEAL":
      return "ESCALATE_TO_MANAGER";
  }
}

// ---------------------------------------------------------------------------
// Pure: lost / won deal explanation frameworks (non-causal wording)
// ---------------------------------------------------------------------------

const LOST_HONESTY =
  "Based on recorded activity only. Listed items are observed facts and potential contributing factors — not proven causes of the lost outcome.";
const WON_HONESTY =
  "Based on recorded activity only. Listed items are observed conversion signals — repeatable workflow evidence, not proven causes of the won outcome.";

export interface DealFacts {
  leadId: string;
  leadName: string | null;
  status: "LOST" | "CONVERTED";
  leadScore: number;
  associatedValue: number | null;
  interestCount: number;
  hasStrongMatch: boolean;
  siteVisitInterest?: boolean | null;
  completedVisits: number;
  missedVisits: number;
  overdueFollowUpCount: number;
  maxResponseDelayHours: number | null;
  inactiveDays: number | null;
  hadUpcomingAtClose: boolean;
}

/** Factual lost-deal explanation. Never claims causality. */
export function buildLostDealAnalysis(facts: DealFacts): ClosedDealAnalysis {
  const observed: string[] = [];
  const factors: string[] = [];
  observed.push(`Lead was scored ${facts.leadScore}/100 at last evaluation.`);
  if (facts.associatedValue != null) {
    observed.push(`Associated opportunity on file: ₹${facts.associatedValue.toLocaleString("en-IN")} (associated value, not a confirmed loss).`);
  } else {
    observed.push("No reliable opportunity value was on file, so no amount is estimated.");
  }
  observed.push(
    facts.interestCount > 0
      ? `${facts.interestCount} propert${facts.interestCount === 1 ? "y was" : "ies were"} considered${facts.hasStrongMatch ? " (including a strong match)" : " (no strong match recorded)"}.`
      : "No property interest rows were recorded."
  );
  if (facts.siteVisitInterest) observed.push("Site-visit interest was recorded.");
  if (facts.completedVisits > 0) observed.push(`${facts.completedVisits} site visit${facts.completedVisits === 1 ? " was" : "s were"} recorded as completed.`);
  if (facts.missedVisits > 0) observed.push(`${facts.missedVisits} site visit${facts.missedVisits === 1 ? " was" : "s were"} recorded as missed.`);
  if (facts.overdueFollowUpCount > 0) {
    observed.push(`${facts.overdueFollowUpCount} overdue follow-up${facts.overdueFollowUpCount === 1 ? " was" : "s were"} on record.`);
    factors.push("Potential contributing factor: follow-up delays occurred while the deal was open (based on recorded activity).");
  }
  if (facts.maxResponseDelayHours != null && facts.maxResponseDelayHours > 12) {
    observed.push(`Slowest observed customer-to-response gap: ~${Math.round(facts.maxResponseDelayHours)}h (based on recorded message timestamps).`);
    factors.push("Potential contributing factor: a response delay occurred during the engagement (based on recorded activity).");
  }
  if (facts.inactiveDays != null && facts.inactiveDays >= 7) {
    observed.push(`Lead was inactive for ~${facts.inactiveDays} days before close (based on recorded activity).`);
    factors.push("Potential contributing factor: extended inactivity preceded the lost outcome (based on recorded activity).");
  }
  if (!facts.hadUpcomingAtClose && facts.siteVisitInterest) {
    factors.push("Potential contributing factor: no appointment was on the books despite recorded site-visit interest (based on recorded activity).");
  }
  if (factors.length === 0) {
    factors.push("No specific workflow issue is observable in the recorded activity — the loss reason is not on record.");
  }
  return {
    leadId: facts.leadId,
    leadName: facts.leadName,
    status: "LOST",
    associatedValue: facts.associatedValue,
    observed,
    potentialContributingFactors: factors,
    conversionSignals: [],
    honestyNote: LOST_HONESTY,
  };
}

/** Factual won-deal analysis. Records repeatable signals without inventing causality. */
export function buildWonDealAnalysis(facts: DealFacts): ClosedDealAnalysis {
  const observed: string[] = [];
  const signals: string[] = [];
  observed.push(`Lead was scored ${facts.leadScore}/100 at last evaluation.`);
  if (facts.associatedValue != null) {
    observed.push(`Associated opportunity on file: ₹${facts.associatedValue.toLocaleString("en-IN")} (associated value, not confirmed collected revenue).`);
  } else {
    observed.push("No reliable opportunity value was on file, so no amount is estimated.");
  }
  if (facts.interestCount > 0) {
    observed.push(`${facts.interestCount} propert${facts.interestCount === 1 ? "y was" : "ies were"} considered.`);
    signals.push(`Repeatable signal: ${facts.interestCount} propert${facts.interestCount === 1 ? "y" : "ies"} considered before conversion (based on recorded activity).`);
  }
  if (facts.completedVisits > 0) {
    observed.push(`${facts.completedVisits} site visit${facts.completedVisits === 1 ? " was" : "s were"} recorded as completed.`);
    signals.push("Repeatable signal: site visit completed before conversion (based on recorded activity).");
  }
  if (facts.maxResponseDelayHours != null && facts.maxResponseDelayHours <= 12) {
    observed.push(`Slowest observed customer-to-response gap: ~${Math.round(facts.maxResponseDelayHours)}h (based on recorded message timestamps).`);
    signals.push("Repeatable signal: responses stayed within ~12h (based on recorded activity).");
  }
  if (facts.overdueFollowUpCount === 0) {
    signals.push("Repeatable signal: no overdue follow-ups on record (based on recorded activity).");
  }
  observed.push("Deal is recorded as won (CRM stage — not payment evidence).");
  if (signals.length === 0) {
    signals.push("No distinct workflow signal is observable in the recorded activity.");
  }
  return {
    leadId: facts.leadId,
    leadName: facts.leadName,
    status: "CONVERTED",
    associatedValue: facts.associatedValue,
    observed,
    potentialContributingFactors: [],
    conversionSignals: signals,
    honestyNote: WON_HONESTY,
  };
}

// ---------------------------------------------------------------------------
// Audit-trail helpers (existing audit_logs table — no migration)
// ---------------------------------------------------------------------------

export const AUTOPILOT_EXECUTE_ACTION = "RECOVERY_AUTOPILOT_EXECUTE";
export const AUTOPILOT_DISMISS_ACTION = "RECOVERY_AUTOPILOT_DISMISS";

export async function recordAutopilotAudit(
  organizationId: string,
  userId: string | null,
  action: string,
  leadId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await db.insert(auditLogs).values({
    organizationId,
    userId: userId ?? null,
    action,
    entityType: "lead",
    entityId: leadId,
    metadataJson: JSON.stringify(metadata),
  });
}

export async function findRecentAutopilotAudits(
  organizationId: string,
  action: string,
  sinceIso: string,
  limit = 500
): Promise<{ entityId: string | null; createdAt: string; metadataJson: string | null }[]> {
  const rows = await db
    .select({ entityId: auditLogs.entityId, createdAt: auditLogs.createdAt, metadataJson: auditLogs.metadataJson })
    .from(auditLogs)
    .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.action, action)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  // createdAt may be DB-default `YYYY-MM-DD HH:MM:SS` (SQLite
  // current_timestamp) or app-written ISO (`...T...Z`); normalize the
  // separator before comparing so the window is exact on both dialects.
  const normalize = (v: string) => v.replace(" ", "T");
  return rows.filter((r) => normalize(String(r.createdAt)) >= sinceIso);
}

// Recovery-titled rows created by the existing recovery paths.
const RECOVERY_TASK_MARKERS = [
  "Review recovery message",
  "Recovery follow-up needed",
  "Recover at-risk lead",
  "Reschedule site visit",
  "Escalated at-risk lead",
  "Human takeover requested",
  "Recovery message ready",
  "Recovery follow-up scheduled",
  "At-risk lead escalated",
];

export function isRecoveryTaskTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return RECOVERY_TASK_MARKERS.some((m) => title.startsWith(m));
}

// ---------------------------------------------------------------------------
// Organization sweep (bounded, tenant-scoped, no N+1)
// ---------------------------------------------------------------------------

export interface AutopilotOptions {
  now?: Date | number;
  /** Agent-scoped view (own + unassigned). Omit for manager-wide view. */
  assignedAgentId?: string | null;
  limit?: number;
}

const MAX_EVALUATED = 120;

export async function getRecoveryAutopilot(
  organizationId: string,
  opts: AutopilotOptions = {}
): Promise<RecoveryAutopilot> {
  const nowMs = opts.now == null ? Date.now() : typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const calculatedAt = new Date(nowMs).toISOString();
  const limit = opts.limit ?? 25;
  const scope = opts.assignedAgentId !== undefined ? { assignedAgentId: opts.assignedAgentId } : {};

  const risk = await getOrganizationRevenueRisk(organizationId, {
    now: nowMs,
    topLimit: 200,
    includeAll: true,
    ...scope,
  });

  // Bounded batched reads — org-scoped, joined in memory (no per-lead N+1
  // except the two inArray phase-2 queries below, mirroring the NBA layer).
  // NOTE: notifications carry no leadId, so they cannot be attributed to a
  // single lead and are intentionally NOT read here (no org-wide scan).
  const [leadRows, convRows, fuRows, apptRows, taskRows, teamRows, dismissAudits, executeAudits, executedEverAudits] =
    await Promise.all([
      db.select().from(leads).where(eq(leads.organizationId, organizationId)),
      db.select().from(conversations).where(eq(conversations.organizationId, organizationId)),
      db.select().from(followUps).where(eq(followUps.organizationId, organizationId)),
      db.select().from(appointments).where(eq(appointments.organizationId, organizationId)),
      db.select().from(tasks).where(eq(tasks.organizationId, organizationId)),
      db.select().from(users).where(eq(users.organizationId, organizationId)),
      findRecentAutopilotAudits(
        organizationId,
        AUTOPILOT_DISMISS_ACTION,
        new Date(nowMs - DISMISS_SUPPRESSION_DAYS * 86_400_000).toISOString()
      ),
      findRecentAutopilotAudits(
        organizationId,
        AUTOPILOT_EXECUTE_ACTION,
        new Date(nowMs - EXECUTE_IDEMPOTENCY_HOURS * 86_400_000).toISOString()
      ),
      // Bounded "ever executed" set for ACTION_EXECUTED state derivation.
      findRecentAutopilotAudits(organizationId, AUTOPILOT_EXECUTE_ACTION, "1970-01-01T00:00:00.000Z", 500),
    ]);

  const visibleLeads =
    opts.assignedAgentId !== undefined
      ? leadRows.filter((l) => !l.assignedAgentId || l.assignedAgentId === opts.assignedAgentId)
      : leadRows;
  const visibleIds = new Set(visibleLeads.map((l) => l.id));
  const leadById = new Map(leadRows.map((l) => [l.id, l]));
  const agentNameById = new Map(teamRows.map((u) => [u.id, u.name]));
  const dismissedLeadIds = new Set(
    dismissAudits.map((a) => a.entityId).filter((v): v is string => v != null && visibleIds.has(v))
  );
  const recentlyExecutedLeadIds = new Set(
    executeAudits.map((a) => a.entityId).filter((v): v is string => v != null)
  );
  const executedEverLeadIds = new Set(
    executedEverAudits.map((a) => a.entityId).filter((v): v is string => v != null)
  );

  // Evaluation set: at-risk leads first (they can leak on any category),
  // then a bounded secondary set of LOW-risk leads that still carry
  // row-factual signals (appointments, follow-ups, handoff threads) so the
  // ungated categories (overdue, unconfirmed visit, post-visit silence,
  // handoff) are not missed on otherwise-healthy leads.
  const riskByLead = new Map(risk.allRisks.map((r) => [r.leadId, r]));
  const evalItems = risk.allRisks
    .filter((r) => visibleIds.has(r.leadId) && r.riskLevel !== "LOW")
    .slice(0, MAX_EVALUATED);
  if (evalItems.length < MAX_EVALUATED) {
    const evaled = new Set(evalItems.map((r) => r.leadId));
    const fuLeadIds = new Set(fuRows.filter((f) => visibleIds.has(f.leadId)).map((f) => f.leadId));
    const apptLeadIds = new Set(
      apptRows.filter((a) => visibleIds.has(a.leadId) && a.status !== "CANCELED").map((a) => a.leadId)
    );
    const handoffLeadIds = new Set(
      convRows.filter((c) => visibleIds.has(c.leadId) && c.status === "HUMAN_HANDLING").map((c) => c.leadId)
    );
    for (const r of risk.allRisks) {
      if (evalItems.length >= MAX_EVALUATED) break;
      if (r.riskLevel !== "LOW" || !visibleIds.has(r.leadId) || evaled.has(r.leadId)) continue;
      if (fuLeadIds.has(r.leadId) || apptLeadIds.has(r.leadId) || handoffLeadIds.has(r.leadId)) {
        evalItems.push(r);
        evaled.add(r.leadId);
      }
    }
  }
  const evalIds = Array.from(new Set(evalItems.map((r) => r.leadId)));

  // Phase 2 (bounded): interests + latest-thread messages for the eval set.
  const latestConvByLead = new Map<string, (typeof convRows)[number]>();
  for (const leadId of evalIds) {
    const convs = convRows.filter((c) => c.leadId === leadId);
    const latest = convs.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
    if (latest) latestConvByLead.set(leadId, latest);
  }
  const evalConvIds = Array.from(new Set(Array.from(latestConvByLead.values()).map((c) => c.id)));
  const [evalInterests, evalMessages] = await Promise.all([
    evalIds.length > 0
      ? db.select().from(leadPropertyInterests).where(inArray(leadPropertyInterests.leadId, evalIds))
      : Promise.resolve([] as (typeof leadPropertyInterests.$inferSelect)[]),
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

  const toHours = (iso: string | null | undefined) =>
    iso ? (nowMs - new Date(iso).getTime()) / 3_600_000 : null;

  const leaks: ScoredLeak[] = [];
  const outcomes: LeadOutcome[] = [];
  let trackedOpportunity = 0;
  const seenOpportunity = new Set<string>();

  for (const item of evalItems) {
    const lead = leadById.get(item.leadId);
    if (!lead) continue;
    const latestConv = latestConvByLead.get(item.leadId) ?? null;
    const thread = [...(latestConv ? (messagesByConv.get(latestConv.id) ?? []) : [])]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20);
    const inboundMsg = thread.find((x) => x.sender === "LEAD") ?? null;
    const outboundMsg = thread.find((x) => x.sender === "AI" || x.sender === "AGENT") ?? null;
    const inboundH = inboundMsg ? toHours(inboundMsg.createdAt) : toHours(item.lastInteractionAt);
    const leadFus = fuRows.filter((f) => f.leadId === lead.id);
    const pendingFu = leadFus.some((f) => f.status === "PENDING");
    const pastDue = leadFus.filter((f) => f.status === "PENDING" && f.scheduledFor <= item.calculatedAt);
    const failed = leadFus.filter((f) => f.status === "FAILED");
    const overdueAges = [
      ...pastDue.map((f) => (nowMs - new Date(f.scheduledFor).getTime()) / 3_600_000),
      ...failed.map((f) => (nowMs - new Date(f.createdAt).getTime()) / 3_600_000),
    ];
    const sentTimes = leadFus
      .filter((f) => f.status === "SENT" && f.sentAt != null)
      .map((f) => new Date(f.sentAt as string).getTime());
    const leadAppts = apptRows.filter((a) => a.leadId === lead.id);
    const upcomingSiteVisits = leadAppts.filter(
      (a) => a.type === "SITE_VISIT" && ["SCHEDULED", "CONFIRMED"].includes(a.status)
    );
    const nextVisitH =
      upcomingSiteVisits
        .map((a) => (new Date(a.scheduledAt).getTime() - nowMs) / 3_600_000)
        .filter((h) => h >= -24)
        .sort((x, y) => x - y)[0] ?? null;
    const nextVisitConfirmed = upcomingSiteVisits.some(
      (a) => a.status === "CONFIRMED" && (new Date(a.scheduledAt).getTime() - nowMs) / 3_600_000 === nextVisitH
    );
    const completedVisits = leadAppts.filter((a) => a.type === "SITE_VISIT" && a.status === "COMPLETED");
    const lastCompletion =
      completedVisits.length > 0 ? Math.max(...completedVisits.map((a) => new Date(a.scheduledAt).getTime())) : null;
    const contactAfterCompletion =
      lastCompletion == null
        ? false
        : thread.some((m) => new Date(m.createdAt).getTime() > lastCompletion) ||
          leadFus.some((f) => f.status === "SENT" && f.sentAt != null && new Date(f.sentAt).getTime() > lastCompletion);
    const interests = evalInterests.filter((i) => i.leadId === lead.id);
    const leadTasks = taskRows.filter((t) => t.leadId === lead.id);
    const openTasks = leadTasks.filter((t) => !t.isDone);
    const openTaskExists = openTasks.length > 0;
    const opportunity = opportunityValueFor(item.propertyValue, lead.budgetMaxInr);
    if (opportunity != null && !seenOpportunity.has(lead.id)) {
      seenOpportunity.add(lead.id);
      trackedOpportunity += opportunity;
    }

    const signal: LeakSignal = {
      leadId: lead.id,
      leadName: lead.name,
      status: lead.status,
      optedOut: lead.optedOut,
      leadScore: item.leadScore,
      temperature: lead.temperature,
      siteVisitInterest: lead.siteVisitInterest,
      riskLevel: item.riskLevel,
      riskScore: item.riskScore,
      riskReasons: item.reasons,
      opportunityValue: opportunity,
      revenueAtRisk: item.revenueAtRisk,
      hasValue: opportunity != null,
      lastInboundHoursAgo: inboundH,
      lastOutboundHoursAgo: outboundMsg ? toHours(outboundMsg.createdAt) : null,
      inboundCount: thread.filter((x) => x.sender === "LEAD").length,
      leadAgeHoursAgo: toHours(lead.createdAt),
      followUpOverdue: item.followUpStatus === "OVERDUE",
      overdueFollowUpCount: pastDue.length + failed.length,
      mostOverdueHoursAgo: overdueAges.length > 0 ? Math.max(...overdueAges) : null,
      pendingFollowUp: pendingFu,
      daysSinceLastAutoOutreach: sentTimes.length === 0 ? null : (nowMs - Math.max(...sentTimes)) / 86_400_000,
      openTaskExists,
      upcomingVisitInHours: nextVisitH,
      upcomingVisitConfirmed: nextVisitConfirmed,
      hasUpcomingAppointment: leadAppts.some(
        (a) => ["SCHEDULED", "CONFIRMED"].includes(a.status) && a.scheduledAt >= item.calculatedAt
      ),
      completedVisitWithoutFollowUp: lastCompletion != null && !contactAfterCompletion,
      hasAnyAppointment: leadAppts.some((a) => a.status !== "CANCELED"),
      hasStrongMatch: interests.some((i) => i.matchType === "EXACT" || i.matchType === "CLOSE"),
      hasAnyInterest: interests.length > 0,
      qualifiedForVisit:
        item.leadScore >= 60 || ["QUALIFIED", "INTERESTED", "NEGOTIATION"].includes(lead.status),
      handoffAwaitingHuman: latestConv?.status === "HUMAN_HANDLING",
      assignedAgentId: lead.assignedAgentId,
      channel: latestConv?.channel ?? "WEBSITE_CHAT",
    };

    // Recovery decision + NBA recommendation are consumed (never rederived).
    const recovery = evaluateRecoveryDecision(
      {
        leadId: lead.id,
        riskLevel: item.riskLevel,
        riskScore: item.riskScore,
        riskReasons: item.reasons,
        leadScore: item.leadScore,
        hasValue: opportunity != null,
        status: lead.status,
        optedOut: lead.optedOut,
        lastInboundHoursAgo: signal.lastInboundHoursAgo,
        lastOutboundHoursAgo: signal.lastOutboundHoursAgo,
        followUpOverdue: signal.followUpOverdue,
        overdueFollowUpCount: signal.overdueFollowUpCount,
        mostOverdueHoursAgo: signal.mostOverdueHoursAgo,
        hasUpcomingAppointment: signal.hasUpcomingAppointment,
        hasMissedVisit: leadAppts.some((a) => a.status === "NO_SHOW"),
        siteVisitInterest: lead.siteVisitInterest,
        handoffAwaitingHuman: signal.handoffAwaitingHuman,
        assignedAgentId: lead.assignedAgentId,
        channel: signal.channel,
        pendingFollowUp: signal.pendingFollowUp,
        daysSinceLastAutoOutreach: signal.daysSinceLastAutoOutreach,
        openTaskExists: signal.openTaskExists,
      },
      nowMs
    );
    const nba = recommendNextBestAction(
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
        hasValue: opportunity != null,
        lastInboundHoursAgo: signal.lastInboundHoursAgo,
        lastOutboundHoursAgo: signal.lastOutboundHoursAgo,
        followUpOverdue: signal.followUpOverdue,
        overdueFollowUpCount: signal.overdueFollowUpCount,
        pendingFollowUp: signal.pendingFollowUp,
        daysSinceLastAutoOutreach: signal.daysSinceLastAutoOutreach,
        openTaskExists: signal.openTaskExists,
        upcomingVisitInHours: signal.upcomingVisitInHours,
        upcomingVisitConfirmed: signal.upcomingVisitConfirmed,
        completedVisitWithoutFollowUp: signal.completedVisitWithoutFollowUp,
        hasAnyAppointment: signal.hasAnyAppointment,
        siteVisitInterest: lead.siteVisitInterest,
        qualifiedForVisit: signal.qualifiedForVisit,
        hasStrongMatch: signal.hasStrongMatch,
        hasAnyInterest: signal.hasAnyInterest,
        handoffAwaitingHuman: signal.handoffAwaitingHuman,
        assignedAgentId: lead.assignedAgentId,
        channel: signal.channel,
        recoveryAction: recovery.shouldRecover ? recovery.actionType : null,
        recoveryShouldAct: recovery.shouldRecover,
      },
      nowMs
    );

    const automation: AutopilotAutomation =
      recovery.automation === "AUTO" ? "AUTO" : recovery.automation === "PREPARE" ? "PREPARE" : "RECOMMEND";
    const guidance =
      automation === "AUTO"
        ? "May execute through the existing follow-up pipeline only (opt-out, closed-status, and max-attempt guards apply)."
        : automation === "PREPARE"
          ? "Basera stages a draft/task for human approval — nothing is sent automatically."
          : "Human must review and act — Basera only recommends.";

    // detected[] is computed once: leak rows below and the outcome state
    // machine share it, so a lead's leaks and its lifecycle state can never
    // disagree about what was detected.
    const detected = detectLeaks(signal, nowMs);
    const dismissed = dismissedLeadIds.has(lead.id);
    // Work-in-flight rows suppress duplicates. (Equivalent to the prior
    // inline form: (X||!shouldRecover)&&X === X.)
    const workInFlightRows =
      signal.pendingFollowUp || signal.openTaskExists || recentlyExecutedLeadIds.has(lead.id);
    for (const leak of detected) {
      const { score, breakdown } = scoreLeakPriority(signal, leak.type);
      const recommendedAction =
        nba.action === "NO_ACTION" || nba.action === "WAIT_AND_MONITOR"
          ? defaultNbaForLeak(leak.type)
          : nba.action;
      const recommendedReason =
        nba.action === "NO_ACTION" || nba.action === "WAIT_AND_MONITOR"
          ? leak.reason
          : nba.reason;
      const status: LeakRecoveryStatus = dismissed
        ? "DISMISSED"
        : workInFlightRows
          ? "IN_PROGRESS"
          : recovery.shouldRecover
            ? "ACTION_NEEDED"
            : "MONITORING";
      leaks.push({
        ...leak,
        leakId: `${lead.id}:${leak.type}`,
        leadId: lead.id,
        leadName: lead.name,
        stage: lead.status,
        riskLevel: item.riskLevel,
        riskScore: item.riskScore,
        opportunityValue: opportunity,
        revenueAtRisk: item.revenueAtRisk,
        priority: dismissed ? Math.min(score, 10) : score,
        priorityBreakdown: breakdown,
        recommendedAction,
        recommendedReason,
        automation,
        executionGuidance: guidance,
        ownerAgentId: lead.assignedAgentId,
        ownerAgentName: lead.assignedAgentId ? (agentNameById.get(lead.assignedAgentId) ?? null) : null,
        hoursSinceLastAction: signal.lastInboundHoursAgo ?? signal.lastOutboundHoursAgo ?? signal.leadAgeHoursAgo ?? null,
        recoveryStatus: status,
        statusDetail: dismissed
          ? "Dismissed by a team member in the last 14 days (advisory — the underlying facts are unchanged)."
          : status === "IN_PROGRESS"
            ? `Work already in flight (${[
                signal.pendingFollowUp ? "pending follow-up" : null,
                signal.openTaskExists ? "open task" : null,
                recentlyExecutedLeadIds.has(lead.id) ? "recently executed" : null,
              ]
                .filter(Boolean)
                .join(", ")}) — duplicate execution is suppressed.`
            : status === "MONITORING"
              ? (recovery.noActionReason ?? "Monitor before acting again.")
              : null,
        cooldownUntil: recovery.cooldownUntil,
      });
    }

    // Outcome tracking (deterministic, from recorded rows only).
    // NOTE: notifications carry no leadId in the schema, so team alerts are
    // org-level activity and are never attributed to a single lead here.
    const recoveryTaskRows = leadTasks.filter((t) => isRecoveryTaskTitle(t.title));
    const firstAttemptAt = [
      ...recoveryTaskRows.map((t) => new Date(t.createdAt).getTime()),
      ...leadFus
        .filter((f) => f.status === "SENT" && f.sentAt != null)
        .map((f) => new Date(f.sentAt as string).getTime()),
    ].reduce((m, t) => Math.min(m, t), Number.POSITIVE_INFINITY);
    const hasAttempt = recoveryTaskRows.length > 0 || leadFus.some((f) => f.status === "SENT");
    const respondedAfter =
      hasAttempt && Number.isFinite(firstAttemptAt)
        ? thread.some((m) => m.sender === "LEAD" && new Date(m.createdAt).getTime() > firstAttemptAt)
        : false;
    const apptAfter =
      hasAttempt && Number.isFinite(firstAttemptAt)
        ? leadAppts.some((a) => new Date(a.createdAt).getTime() > firstAttemptAt)
        : false;
    const visitAfter =
      hasAttempt && Number.isFinite(firstAttemptAt)
        ? completedVisits.some((a) => new Date(a.scheduledAt).getTime() > firstAttemptAt)
        : false;
    const siteVisitBookedAfter =
      hasAttempt && Number.isFinite(firstAttemptAt)
        ? leadAppts.some((a) => a.type === "SITE_VISIT" && new Date(a.createdAt).getTime() > firstAttemptAt)
        : false;
    const detail: string[] = [];
    if (recoveryTaskRows.length > 0) detail.push(`${recoveryTaskRows.length} recovery task${recoveryTaskRows.length === 1 ? "" : "s"} on record.`);
    const sentFus = leadFus.filter((f) => f.status === "SENT").length;
    if (sentFus > 0) detail.push(`${sentFus} follow-up${sentFus === 1 ? "" : "s"} sent (recorded).`);
    if (hasAttempt) {
      const positive = respondedAfter || apptAfter || visitAfter;
      const { state: recoveryState, stateEvidence } = deriveRecoveryState({
        currentStatus: lead.status,
        hasAnyLeak: detected.length > 0,
        hasActionNeededLeak: detected.length > 0 && !dismissed && !workInFlightRows && recovery.shouldRecover,
        recoveryTasksStaged: recoveryTaskRows.length,
        executeAuditExists: executedEverLeadIds.has(lead.id),
        sentFollowUps: sentFus,
        customerRespondedAfterAttempt: respondedAfter,
        siteVisitBookedAfterAttempt: siteVisitBookedAfter,
        visitCompletedAfterAttempt: visitAfter,
      });
      outcomes.push({
        leadId: lead.id,
        leadName: lead.name,
        attempts: recoveryTaskRows.length + sentFus,
        attemptsDetail: detail,
        customerRespondedAfterAttempt: respondedAfter,
        appointmentCreatedAfterAttempt: apptAfter,
        visitCompletedAfterAttempt: visitAfter,
        currentStatus: lead.status,
        positiveOutcome: positive,
        recoveryState,
        stateEvidence,
        confirmationStatus: positive ? "CONFIRMED_RESPONSE" : "OUTCOME_NOT_YET_CONFIRMED",
        confirmationLabel: respondedAfter
          ? "Confirmed: customer responded after the recovery attempt (timestamped inbound message)."
          : apptAfter || visitAfter
            ? "Confirmed: appointment/visit activity recorded after the recovery attempt."
            : OUTCOME_NOT_YET_CONFIRMED_LABEL,
        revenueNote: "Response/appointment/visit after an attempt is a positive recovery outcome — not recovered revenue.",
      });
    }
  }

  // Sort: action-needed first, then urgency-first score, value only as tie-break.
  const statusRank: Record<LeakRecoveryStatus, number> = {
    ACTION_NEEDED: 0,
    MONITORING: 1,
    IN_PROGRESS: 2,
    DISMISSED: 3,
  };
  leaks.sort(
    (a, b) =>
      statusRank[a.recoveryStatus] - statusRank[b.recoveryStatus] ||
      b.priority - a.priority ||
      (b.opportunityValue ?? -1) - (a.opportunityValue ?? -1) ||
      (a.leadId < b.leadId ? -1 : 1)
  );

  // Closed-deal analyses (bounded, visible closed leads, most recent first).
  const closedLeads = leadRows
    .filter((l) => visibleIds.has(l.id) && CLOSED_STATUSES.includes(l.status))
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .reverse()
    .slice(0, 20);
  const closedIds = new Set(closedLeads.map((l) => l.id));
  const [closedInterests, closedScoreEvents] = await Promise.all([
    closedIds.size > 0
      ? db.select().from(leadPropertyInterests).where(inArray(leadPropertyInterests.leadId, Array.from(closedIds)))
      : Promise.resolve([] as (typeof leadPropertyInterests.$inferSelect)[]),
    closedIds.size > 0
      ? db.select().from(leadScoreEvents).where(inArray(leadScoreEvents.leadId, Array.from(closedIds)))
      : Promise.resolve([] as (typeof leadScoreEvents.$inferSelect)[]),
  ]);
  void closedScoreEvents;
  const lostDeals: ClosedDealAnalysis[] = [];
  const wonDeals: ClosedDealAnalysis[] = [];
  // Closed leads with recovery activity on record (association only: the
  // schema records no status-change timestamps, so attempt-vs-close order
  // is not claimed).
  let dealsWonWithActivity = 0;
  let dealsLostWithActivity = 0;
  for (const lead of closedLeads) {
    const interests = closedInterests.filter((i) => i.leadId === lead.id);
    const leadFus = fuRows.filter((f) => f.leadId === lead.id);
    const closedTaskRows = taskRows.filter((t) => t.leadId === lead.id && isRecoveryTaskTitle(t.title));
    const closedSentFus = leadFus.filter((f) => f.status === "SENT").length;
    if (closedTaskRows.length > 0 || closedSentFus > 0 || executedEverLeadIds.has(lead.id)) {
      if (lead.status === "CONVERTED") dealsWonWithActivity += 1;
      else dealsLostWithActivity += 1;
    }
    const leadAppts = apptRows.filter((a) => a.leadId === lead.id);
    const convs = convRows.filter((c) => c.leadId === lead.id);
    const latestConv = convs.slice().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null;
    const latestRisk = riskByLead.get(lead.id);
    const facts: DealFacts = {
      leadId: lead.id,
      leadName: lead.name,
      status: lead.status as "LOST" | "CONVERTED",
      leadScore: lead.score ?? latestRisk?.leadScore ?? 0,
      associatedValue: opportunityValueFor(latestRisk?.propertyValue ?? null, lead.budgetMaxInr),
      interestCount: interests.length,
      hasStrongMatch: interests.some((i) => i.matchType === "EXACT" || i.matchType === "CLOSE"),
      siteVisitInterest: lead.siteVisitInterest,
      completedVisits: leadAppts.filter((a) => a.type === "SITE_VISIT" && a.status === "COMPLETED").length,
      missedVisits: leadAppts.filter((a) => a.status === "NO_SHOW").length,
      overdueFollowUpCount: leadFus.filter(
        (f) => f.status === "FAILED" || (f.status === "PENDING" && f.scheduledFor <= calculatedAt)
      ).length,
      // Response-delay evidence is only available when thread messages were
      // read; the sweep reads threads for the at-risk set, so for closed
      // leads this stays honestly absent (null) rather than guessed.
      maxResponseDelayHours: null,
      inactiveDays:
        latestConv && nowMs - new Date(latestConv.updatedAt).getTime() > 0
          ? Math.floor((nowMs - new Date(latestConv.updatedAt).getTime()) / 86_400_000)
          : null,
      hadUpcomingAtClose: leadAppts.some((a) => ["SCHEDULED", "CONFIRMED"].includes(a.status)),
    };
    if (lead.status === "LOST") lostDeals.push(buildLostDealAnalysis(facts));
    else wonDeals.push(buildWonDealAnalysis(facts));
  }

  const activeLeaks = leaks.filter((l) => l.recoveryStatus !== "DISMISSED");
  const attempts = outcomes.reduce((s, o) => s + o.attempts, 0);
  const positive = outcomes.filter((o) => o.positiveOutcome).length;

  return {
    calculatedAt,
    scopedToAgentId: opts.assignedAgentId ?? null,
    overview: {
      trackedOpportunity,
      revenueAtRisk: risk.totalRevenueAtRisk,
      activeLeaks: activeLeaks.length,
      criticalLeaks: activeLeaks.filter((l) => l.riskLevel === "CRITICAL").length,
      highPriorityActions: activeLeaks.filter((l) => l.recoveryStatus === "ACTION_NEEDED").length,
      recoveryAttempts: attempts,
      positiveOutcomes: positive,
      recoveryResponses: outcomes.filter((o) => o.customerRespondedAfterAttempt).length,
      appointmentsRecovered: outcomes.filter((o) => o.appointmentCreatedAfterAttempt).length,
      siteVisitsRecovered: outcomes.filter((o) => o.visitCompletedAfterAttempt).length,
      dealsWonWithActivity,
      dealsLostWithActivity,
      // NEVER a number. The key exists so UIs render the honesty note.
      recoveredRevenue: null,
      honestyNote: RECOVERED_REVENUE_HONESTY_NOTE,
    },
    leaks: leaks.slice(0, limit),
    outcomes: outcomes.slice(0, limit),
    lostDeals,
    wonDeals,
  };
}

// ---------------------------------------------------------------------------
// Per-lead factual timeline (existing rows only, chronological)
// ---------------------------------------------------------------------------

export interface RecoveryTimeline {
  leadId: string;
  leadName: string | null;
  status: string;
  opportunityValue: number | null;
  revenueAtRisk: number | null;
  events: TimelineEvent[];
  generatedAt: string;
  honestyNote: string;
}

export async function getRecoveryTimeline(
  organizationId: string,
  leadId: string,
  opts: { now?: Date | number } = {}
): Promise<RecoveryTimeline | null> {
  const nowMs = opts.now == null ? Date.now() : typeof opts.now === "number" ? opts.now : opts.now.getTime();
  void nowMs;
  const leadRows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  const lead = leadRows[0] ?? null;
  if (!lead) return null;

  // NOTE: notifications carry no leadId in the schema, so team alerts are
  // org-level rows that cannot be attributed to one lead — they are
  // intentionally excluded from per-lead timelines rather than guessed.
  const [scoreEvents, convs, fus, appts, leadTasks, audits] = await Promise.all([
    db.select().from(leadScoreEvents).where(eq(leadScoreEvents.leadId, leadId)).orderBy(desc(leadScoreEvents.createdAt)).limit(20),
    db.select().from(conversations).where(and(eq(conversations.organizationId, organizationId), eq(conversations.leadId, leadId))).orderBy(desc(conversations.updatedAt)).limit(5),
    db.select().from(followUps).where(and(eq(followUps.organizationId, organizationId), eq(followUps.leadId, leadId))).orderBy(desc(followUps.createdAt)).limit(30),
    db.select().from(appointments).where(and(eq(appointments.organizationId, organizationId), eq(appointments.leadId, leadId))).orderBy(desc(appointments.scheduledAt)).limit(30),
    db.select().from(tasks).where(and(eq(tasks.organizationId, organizationId), eq(tasks.leadId, leadId))).orderBy(desc(tasks.createdAt)).limit(30),
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityId, leadId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50),
  ]);

  const convIds = new Set(convs.map((c) => c.id));
  const threadMessages =
    convIds.size > 0
      ? await db
          .select({
            conversationId: messages.conversationId,
            sender: messages.sender,
            content: messages.content,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(inArray(messages.conversationId, Array.from(convIds)))
          .orderBy(desc(messages.createdAt))
          .limit(50)
      : [];

  const events: TimelineEvent[] = [];
  events.push({
    at: lead.createdAt,
    kind: "LEAD_CREATED",
    title: "Lead created",
    detail: `Source: ${lead.source}. Status today: ${lead.status.replace(/_/g, " ").toLowerCase()} (current snapshot, not a historical event).`,
    source: "leads",
  });
  for (const e of scoreEvents) {
    events.push({
      at: e.createdAt,
      kind: "LEAD_SCORED",
      title: `Scored ${e.score}/100 (${e.temperature})`,
      detail: e.reason,
      source: "lead_score_events",
    });
  }
  for (const m of threadMessages) {
    events.push({
      at: m.createdAt,
      kind: m.sender === "LEAD" ? "MESSAGE_INBOUND" : m.sender === "SYSTEM" ? "MESSAGE_SYSTEM" : "MESSAGE_OUTBOUND",
      title: m.sender === "LEAD" ? "Customer message" : m.sender === "SYSTEM" ? "System note" : `${m.sender === "AI" ? "AI" : "Agent"} response`,
      detail: m.content.length > 140 ? `${m.content.slice(0, 140)}…` : m.content,
      source: "messages",
    });
  }
  for (const f of fus) {
    events.push({
      at: f.status === "SENT" && f.sentAt ? f.sentAt : f.createdAt,
      kind: `FOLLOW_UP_${f.status}`,
      title: `Follow-up ${f.status.toLowerCase()} (attempt ${f.attemptNumber})`,
      detail:
        f.status === "SENT"
          ? "Recorded as sent through the follow-up pipeline."
          : f.status === "PENDING"
            ? `Scheduled for ${f.scheduledFor}.`
            : (f.stopReason ?? `Status: ${f.status}.`),
      source: "follow_ups",
    });
  }
  for (const a of appts) {
    events.push({
      at: a.scheduledAt,
      kind: `APPOINTMENT_${a.status}`,
      title: `${a.type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} ${a.status.toLowerCase()}`,
      detail: a.notes ?? `Recorded appointment row (status ${a.status}).`,
      source: "appointments",
    });
  }
  for (const t of leadTasks) {
    const recovery = isRecoveryTaskTitle(t.title);
    events.push({
      at: t.createdAt,
      kind: recovery ? "RECOVERY_TASK" : "TASK",
      title: t.isDone ? `Task done: ${t.title}` : t.title,
      detail: recovery ? "Recovery action recorded as a task (attempt — not revenue)." : "Internal task row.",
      source: "tasks",
    });
  }
  for (const a of audits.filter((x) => x.action === AUTOPILOT_EXECUTE_ACTION || x.action === AUTOPILOT_DISMISS_ACTION)) {
    let detail = "Autopilot audit marker.";
    try {
      const meta = a.metadataJson ? (JSON.parse(a.metadataJson) as { leakType?: string; summary?: string }) : null;
      detail = meta?.summary ?? (meta?.leakType ? `Leak: ${meta.leakType}.` : detail);
    } catch {
      // Keep the default wording — never fail a timeline on a bad JSON row.
    }
    events.push({
      at: a.createdAt,
      kind: a.action === AUTOPILOT_EXECUTE_ACTION ? "RECOVERY_EXECUTED" : "RECOVERY_DISMISSED",
      title: a.action === AUTOPILOT_EXECUTE_ACTION ? "Recovery action executed" : "Recovery action dismissed",
      detail,
      source: "audit_logs",
    });
  }

  // Chronological by parsed time (rows mix DB-default `... HH:MM:SS` and
  // app-written `...T...Z` stamps, so string order is not time order).
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // Opportunity anchor mirrors the at-risk rule (midpoint else budget else null).
  const opportunity = opportunityValueFor(null, lead.budgetMaxInr);

  return {
    leadId: lead.id,
    leadName: lead.name,
    status: lead.status,
    opportunityValue: opportunity,
    revenueAtRisk: null,
    events,
    generatedAt: new Date(nowMs).toISOString(),
    honestyNote:
      "Timeline shows recorded rows only, in chronological order. Current status is a snapshot, not a historical event. No events are inferred or backfilled.",
  };
}

/** Action ids in autopilot payloads are deterministic `leadId:LEAK_TYPE`
 *  strings; execution itself is lead-scoped (the underlying recovery
 *  decision is per-lead), so both the bare lead id and the composite form
 *  resolve here. */
export function resolveAutopilotLeadId(actionId: string): string {
  return actionId.split(":")[0] ?? actionId;
}

/** Cooldown (days) guarding a leak type — reuses the recovery engine's table
 *  so the two systems can never disagree about duplicate protection. */
export function cooldownDaysForLeak(type: RevenueLeakType): number {
  switch (type) {
    case "FOLLOW_UP_OVERDUE":
      return RECOVERY_COOLDOWN_DAYS.FOLLOW_UP;
    case "DORMANT_HIGH_VALUE":
      return RECOVERY_COOLDOWN_DAYS.REACTIVATION;
    case "SITE_VISIT_NOT_CONFIRMED":
    case "SITE_VISIT_NO_FOLLOW_UP":
      return RECOVERY_COOLDOWN_DAYS.SITE_VISIT_RECOVERY;
    case "HIGH_RISK_DEAL":
      return RECOVERY_COOLDOWN_DAYS.MANAGER_ESCALATION;
    case "HUMAN_HANDOFF_REQUIRED":
      return RECOVERY_COOLDOWN_DAYS.HUMAN_HANDOFF;
    case "UNANSWERED_HIGH_INTENT":
    case "AGENT_SLA_BREACH":
    case "PROPERTY_MISMATCH":
      return RECOVERY_COOLDOWN_DAYS.AGENT_ALERT;
  }
}
