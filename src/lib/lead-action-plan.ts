import type { NextBestAction } from "./next-best-action";
import { formatInr } from "./formatters";
import { isClosedStatus, stageLabelForStatus } from "./pipeline";

/**
 * LEAD ACTION PLAN (pure)
 * ------------------------------------------------------------------
 * Answers the three questions a salesperson asks when opening a lead:
 *
 *   1. What should I do next?   → nextAction (label + detail + tone)
 *   2. What is owed to the lead? → followUp   (overdue / today / scheduled)
 *   3. What do they actually want? → requirementSummary + gaps
 *
 * Everything is computed from recorded rows only (lead fields, message
 * timestamps, follow-ups, appointments, interests) — nothing is inferred
 * or invented. All time flows in through `signals.nowMs`, so the same
 * inputs always produce the same plan (fully unit-testable).
 *
 * `signals.nbaAction` / `nbaReason` are optional passthroughs from the
 * existing Next-Best-Action engine; when present they are used as the
 * fallback recommendation so this layer never disagrees with it.
 */

export interface LeadActionPlanLead {
  status: string;
  optedOut?: boolean | null;
  nextFollowUpAt?: string | null;
  lastContactAt?: string | null;
  name?: string | null;
  score?: number | null;
  preferredCity?: string | null;
  preferredLocality?: string | null;
  propertyType?: string | null;
  bhk?: number | null;
  budgetMinInr?: number | null;
  budgetMaxInr?: number | null;
  purpose?: string | null;
  timeline?: string | null;
  siteVisitInterest?: boolean | null;
  loanRequired?: boolean | null;
}

export interface LeadActionPlanSignals {
  nowMs?: number;
  /** Last inbound LEAD message across all of the lead's conversations. */
  lastInboundAt?: string | null;
  /** Last outbound AI/AGENT message across all conversations. */
  lastOutboundAt?: string | null;
  handoffAwaitingHuman?: boolean;
  overdueFollowUpCount?: number;
  pendingFollowUp?: boolean;
  nextSiteVisitAt?: string | null;
  nextSiteVisitConfirmed?: boolean;
  lastCompletedSiteVisitAt?: string | null;
  contactAfterSiteVisit?: boolean;
  hasAnyAppointment?: boolean;
  savedInterestCount?: number;
  hasStrongMatch?: boolean;
  /** Optional output from the existing next-best-action engine. */
  nbaAction?: NextBestAction | null;
  nbaReason?: string | null;
}

export type FollowUpState = "OVERDUE" | "DUE_TODAY" | "SCHEDULED" | "NONE" | "CLOSED";

export interface FollowUpPlan {
  state: FollowUpState;
  label: string;
  at: string | null;
}

export type SiteVisitState =
  | "NONE"
  | "INTERESTED_PENDING"
  | "SCHEDULED"
  | "CONFIRM"
  | "COMPLETED"
  | "CLOSED";

export interface SiteVisitPlan {
  state: SiteVisitState;
  label: string;
  at: string | null;
}

export type NextActionTone = "urgent" | "soon" | "normal" | "done";

export type NextActionSource =
  | "closed"
  | "opt-out"
  | "follow-up"
  | "response"
  | "site-visit"
  | "requirement"
  | "nba"
  | "default";

export interface NextActionPlan {
  label: string;
  detail: string;
  tone: NextActionTone;
  source: NextActionSource;
}

export interface LeadActionPlan {
  followUp: FollowUpPlan;
  siteVisit: SiteVisitPlan;
  requirementSummary: string | null;
  gaps: string[];
  nextAction: NextActionPlan;
  nbaAction: NextBestAction | null;
  nbaReason: string | null;
}

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function hoursUntil(iso: string, nowMs: number): number {
  return (new Date(iso).getTime() - nowMs) / 3_600_000;
}

function formatDay(iso: string, nowMs: number): string {
  const target = startOfDay(new Date(iso).getTime());
  const today = startOfDay(nowMs);
  if (target === today) return "today";
  if (target === today + DAY_MS) return "tomorrow";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const QUALIFIED_STATUSES = ["QUALIFIED", "INTERESTED", "NEGOTIATION", "SITE_VISIT_SCHEDULED"];

const PURPOSE_VERB: Record<string, string> = {
  BUY: "buying",
  RENT: "renting",
  INVEST: "investing in",
};

const TYPE_LABEL: Record<string, string> = {
  APARTMENT: "apartment",
  VILLA: "villa",
  PLOT: "plot",
  INDEPENDENT_HOUSE: "independent house",
  COMMERCIAL: "commercial property",
};

function articleFor(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** "Interested in buying a 3 BHK apartment in Sector 33, Gurgaon under ₹1.25 Cr" */
export function buildRequirementSummary(lead: LeadActionPlanLead): string | null {
  const whatParts: string[] = [];
  if (lead.bhk) whatParts.push(`${lead.bhk} BHK`);
  const typeLabel = lead.propertyType ? TYPE_LABEL[lead.propertyType] ?? null : null;
  if (lead.bhk) whatParts.push(typeLabel ?? "home");
  else if (typeLabel) whatParts.push(typeLabel);

  const places = [lead.preferredLocality, lead.preferredCity].filter(Boolean).join(", ");
  const budget = lead.budgetMaxInr
    ? `under ${formatInr(lead.budgetMaxInr)}`
    : lead.budgetMinInr
      ? `above ${formatInr(lead.budgetMinInr)}`
      : null;

  if (whatParts.length === 0 && !places && !budget) return null;

  const verb = lead.purpose ? PURPOSE_VERB[lead.purpose] : null;
  const fallbackNoun: Record<string, string> = {
    BUY: "a property to buy",
    RENT: "a property to rent",
    INVEST: "an investment property",
  };
  let sentence = "Interested in ";
  if (whatParts.length > 0) {
    const noun = whatParts.join(" ");
    sentence += verb ? `${verb} ${articleFor(noun)} ${noun}` : `${articleFor(noun)} ${noun}`;
  } else {
    sentence += lead.purpose ? fallbackNoun[lead.purpose] : "a property";
  }
  if (places) sentence += ` in ${places}`;
  if (budget) sentence += ` ${budget}`;
  if (lead.timeline) sentence += `, within ${lead.timeline.toLowerCase()}`;
  return sentence;
}

/** Missing qualification data a salesperson should still confirm. */
export function requirementGaps(lead: LeadActionPlanLead): string[] {
  const gaps: string[] = [];
  if (lead.budgetMinInr == null && lead.budgetMaxInr == null) gaps.push("Budget confirmation required");
  if (!lead.bhk && !lead.propertyType) gaps.push("Property requirement missing (bedrooms / type)");
  if (!lead.preferredCity) gaps.push("Location required");
  if (!lead.timeline) gaps.push("Purchase timeline unknown");
  if (!lead.purpose) gaps.push("Purpose (buy / rent) unknown");
  return gaps;
}

export function buildFollowUpPlan(lead: LeadActionPlanLead, signals: LeadActionPlanSignals): FollowUpPlan {
  const nowMs = signals.nowMs ?? Date.now();
  if (isClosedStatus(lead.status)) {
    return { state: "CLOSED", label: "No follow-up — lead is closed", at: null };
  }
  if (lead.optedOut) {
    return { state: "CLOSED", label: "Follow-ups stopped — lead opted out", at: null };
  }
  const at = lead.nextFollowUpAt ?? null;
  if (!at) {
    return { state: "NONE", label: "No follow-up scheduled", at: null };
  }
  const due = startOfDay(new Date(at).getTime());
  const today = startOfDay(nowMs);
  if (due < today) {
    return { state: "OVERDUE", label: `Follow-up overdue since ${formatDay(at, nowMs)}`, at };
  }
  if (due === today) {
    return { state: "DUE_TODAY", label: "Follow up today", at };
  }
  return { state: "SCHEDULED", label: `Follow up ${formatDay(at, nowMs)}`, at };
}

export function buildSiteVisitPlan(lead: LeadActionPlanLead, signals: LeadActionPlanSignals): SiteVisitPlan {
  const nowMs = signals.nowMs ?? Date.now();
  if (isClosedStatus(lead.status)) {
    return { state: "CLOSED", label: "—", at: null };
  }
  if (signals.nextSiteVisitAt) {
    const hours = hoursUntil(signals.nextSiteVisitAt, nowMs);
    if (!signals.nextSiteVisitConfirmed && hours <= 48) {
      return {
        state: "CONFIRM",
        label: `Confirm site visit ${formatDateTime(signals.nextSiteVisitAt)}`,
        at: signals.nextSiteVisitAt,
      };
    }
    return {
      state: "SCHEDULED",
      label: `Site visit scheduled ${formatDateTime(signals.nextSiteVisitAt)}`,
      at: signals.nextSiteVisitAt,
    };
  }
  if (signals.lastCompletedSiteVisitAt) {
    return signals.contactAfterSiteVisit === false
      ? { state: "COMPLETED", label: "Site visit completed — follow up pending", at: signals.lastCompletedSiteVisitAt }
      : { state: "COMPLETED", label: "Site visit completed", at: signals.lastCompletedSiteVisitAt };
  }
  if (lead.siteVisitInterest) {
    return { state: "INTERESTED_PENDING", label: "Site visit pending — customer is interested", at: null };
  }
  return { state: "NONE", label: "No site visit yet", at: null };
}

const NBA_LABEL: Record<NextBestAction, string> = {
  RESPOND_TO_CUSTOMER: "Reply to customer",
  FOLLOW_UP: "Follow up now",
  BOOK_SITE_VISIT: "Book site visit",
  CONFIRM_SITE_VISIT: "Confirm site visit",
  FOLLOW_UP_AFTER_SITE_VISIT: "Follow up after site visit",
  REACTIVATE_LEAD: "Reactivate lead",
  FIND_BETTER_PROPERTY: "Find a better property",
  ESCALATE_TO_MANAGER: "Escalate to manager",
  HANDOFF_TO_HUMAN: "Take over the conversation",
  WAIT_AND_MONITOR: "Monitor — outreach may already be in flight",
  NO_ACTION: "No action needed",
};

const NBA_TONE: Record<NextBestAction, NextActionTone> = {
  RESPOND_TO_CUSTOMER: "urgent",
  CONFIRM_SITE_VISIT: "urgent",
  FOLLOW_UP_AFTER_SITE_VISIT: "urgent",
  BOOK_SITE_VISIT: "soon",
  FOLLOW_UP: "soon",
  ESCALATE_TO_MANAGER: "urgent",
  HANDOFF_TO_HUMAN: "urgent",
  REACTIVATE_LEAD: "normal",
  FIND_BETTER_PROPERTY: "normal",
  WAIT_AND_MONITOR: "normal",
  NO_ACTION: "done",
};

const GAP_ACTION: Record<string, { label: string; detail: string }> = {
  "Budget confirmation required": {
    label: "Confirm budget",
    detail: "No budget is on file — ask what they are comfortable spending.",
  },
  "Property requirement missing (bedrooms / type)": {
    label: "Capture property requirement",
    detail: "Bedrooms and property type are still unknown.",
  },
  "Location required": {
    label: "Confirm location",
    detail: "Preferred city is missing, so inventory cannot be shortlisted.",
  },
  "Purchase timeline unknown": {
    label: "Confirm timeline",
    detail: "Ask when they plan to buy so urgency can be scored correctly.",
  },
  "Purpose (buy / rent) unknown": {
    label: "Confirm buy or rent",
    detail: "Purpose is not recorded yet — it changes which inventory applies.",
  },
};

export function describeNextAction(
  lead: LeadActionPlanLead,
  signals: LeadActionPlanSignals,
  followUp: FollowUpPlan,
  siteVisit: SiteVisitPlan,
  gaps: string[]
): NextActionPlan {
  const nowMs = signals.nowMs ?? Date.now();

  if (lead.status === "CONVERTED") {
    return {
      label: "Won — hand over to closures",
      detail: "Lead is converted. No further pipeline action is needed.",
      tone: "done",
      source: "closed",
    };
  }
  if (lead.status === "LOST") {
    return { label: "Lost — closed", detail: "Lead is marked lost.", tone: "done", source: "closed" };
  }
  if (lead.optedOut) {
    return {
      label: "Do not contact",
      detail: "Lead opted out of messages.",
      tone: "done",
      source: "opt-out",
    };
  }

  if ((signals.overdueFollowUpCount ?? 0) > 0 || followUp.state === "OVERDUE" || followUp.state === "DUE_TODAY") {
    return {
      label: "Follow up today",
      detail:
        followUp.state === "OVERDUE"
          ? followUp.label
          : "A follow-up is due today.",
      tone: "urgent",
      source: "follow-up",
    };
  }

  if (signals.handoffAwaitingHuman) {
    return {
      label: "Take over the conversation",
      detail: "The conversation is waiting for a human reply.",
      tone: "urgent",
      source: "response",
    };
  }

  const inboundAt = signals.lastInboundAt ? new Date(signals.lastInboundAt).getTime() : null;
  const outboundAt = signals.lastOutboundAt ? new Date(signals.lastOutboundAt).getTime() : null;
  const unanswered =
    inboundAt != null &&
    (outboundAt == null || outboundAt < inboundAt) &&
    nowMs - inboundAt <= 72 * 3_600_000;
  if (unanswered) {
    return {
      label: "Reply to customer",
      detail: "Customer is waiting for a response.",
      tone: "urgent",
      source: "response",
    };
  }

  if (siteVisit.state === "CONFIRM") {
    return {
      label: "Confirm site visit",
      detail: siteVisit.label,
      tone: "urgent",
      source: "site-visit",
    };
  }

  if (siteVisit.state === "COMPLETED" && signals.contactAfterSiteVisit === false) {
    return {
      label: "Follow up after site visit",
      detail: "Visit is done but no follow-up contact is recorded.",
      tone: "urgent",
      source: "site-visit",
    };
  }

  const qualifiedForVisit =
    (lead.score ?? 0) >= 60 || QUALIFIED_STATUSES.includes(lead.status);
  if (lead.siteVisitInterest && qualifiedForVisit && !signals.hasAnyAppointment) {
    return {
      label: "Book site visit",
      detail: "Qualified lead wants a visit and none is scheduled.",
      tone: "soon",
      source: "site-visit",
    };
  }

  if (followUp.state === "SCHEDULED" && followUp.at) {
    return {
      label: followUp.label,
      detail: "A follow-up is already planned — keep to it.",
      tone: "soon",
      source: "follow-up",
    };
  }

  if (gaps.length > 0) {
    const action = GAP_ACTION[gaps[0]] ?? { label: gaps[0], detail: "Qualification data is incomplete." };
    return { label: action.label, detail: action.detail, tone: "soon", source: "requirement" };
  }

  if (signals.nbaAction && signals.nbaAction !== "NO_ACTION" && signals.nbaAction !== "WAIT_AND_MONITOR") {
    return {
      label: NBA_LABEL[signals.nbaAction],
      detail: signals.nbaReason ?? "Recommended by the next-best-action engine.",
      tone: NBA_TONE[signals.nbaAction],
      source: "nba",
    };
  }
  if (signals.nbaAction === "NO_ACTION") {
    return { label: "No action needed", detail: signals.nbaReason ?? "Lead is healthy.", tone: "done", source: "nba" };
  }

  return {
    label: `Keep ${lead.name ? lead.name.split(" ")[0] : "the lead"} warm`,
    detail: `Stage: ${stageLabelForStatus(lead.status)}. No urgent signal recorded.`,
    tone: "normal",
    source: "default",
  };
}

export function buildLeadActionPlan(lead: LeadActionPlanLead, signals: LeadActionPlanSignals = {}): LeadActionPlan {
  const followUp = buildFollowUpPlan(lead, signals);
  const siteVisit = buildSiteVisitPlan(lead, signals);
  const requirementSummary = buildRequirementSummary(lead);
  const gaps = isClosedStatus(lead.status) ? [] : requirementGaps(lead);
  const nextAction = describeNextAction(lead, signals, followUp, siteVisit, gaps);

  return {
    followUp,
    siteVisit,
    requirementSummary,
    gaps,
    nextAction,
    nbaAction: signals.nbaAction ?? null,
    nbaReason: signals.nbaReason ?? null,
  };
}
