import "server-only";

export interface ScoringInputs {
  hasBudget: boolean;
  hasLocation: boolean;
  hasBhkOrType: boolean;
  timelineWithinDays: number | null; // parsed from lead.timeline, null if unknown
  engagementMessageCount: number; // number of lead messages in conversation
  hasPropertyMatch: boolean; // at least one CLOSE/EXACT match found
  siteVisitInterest: boolean | null;
  loanRequired: boolean | null; // readiness signal, not a negative
  respondedQuickly: boolean; // replied within a reasonable window historically
}

export interface ScoringWeights {
  budgetClarity: number;
  requirementClarity: number;
  timeline: number;
  engagement: number;
  propertyMatch: number;
  siteVisitInterest: number;
  financingReadiness: number;
  responseBehavior: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  budgetClarity: 15,
  requirementClarity: 15,
  timeline: 20,
  engagement: 10,
  propertyMatch: 15,
  siteVisitInterest: 15,
  financingReadiness: 5,
  responseBehavior: 5,
};

export interface ScoringThresholds {
  hot: number;
  warm: number;
}

export const DEFAULT_THRESHOLDS: ScoringThresholds = { hot: 80, warm: 50 };

export interface ScoreResult {
  score: number;
  temperature: "HOT" | "WARM" | "COLD";
  breakdown: { factor: string; points: number; max: number }[];
}

/**
 * Deterministic, auditable scoring (no AI call) — a business can explain to
 * a salesperson exactly why a lead scored 91, and thresholds/weights are
 * configurable per organization (see ScoringConfig in the DB).
 */
export function scoreLead(inputs: ScoringInputs, weights: ScoringWeights = DEFAULT_WEIGHTS, thresholds: ScoringThresholds = DEFAULT_THRESHOLDS): ScoreResult {
  const effectiveWeights = { ...DEFAULT_WEIGHTS, ...weights };
  const effectiveThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const breakdown: ScoreResult["breakdown"] = [];

  const budgetPts = inputs.hasBudget ? effectiveWeights.budgetClarity : 0;
  breakdown.push({ factor: "Budget clarity", points: budgetPts, max: effectiveWeights.budgetClarity });

  const reqPts = (inputs.hasLocation ? 0.5 : 0) * effectiveWeights.requirementClarity + (inputs.hasBhkOrType ? 0.5 : 0) * effectiveWeights.requirementClarity;
  breakdown.push({ factor: "Requirement clarity", points: Math.round(reqPts), max: effectiveWeights.requirementClarity });

  let timelinePts = 0;
  if (inputs.timelineWithinDays != null) {
    if (inputs.timelineWithinDays <= 30) timelinePts = effectiveWeights.timeline;
    else if (inputs.timelineWithinDays <= 90) timelinePts = Math.round(effectiveWeights.timeline * 0.6);
    else timelinePts = Math.round(effectiveWeights.timeline * 0.25);
  }
  breakdown.push({ factor: "Buying timeline", points: timelinePts, max: effectiveWeights.timeline });

  const engagementPts = Math.min(effectiveWeights.engagement, inputs.engagementMessageCount * (effectiveWeights.engagement / 6));
  breakdown.push({ factor: "Engagement", points: Math.round(engagementPts), max: effectiveWeights.engagement });

  const matchPts = inputs.hasPropertyMatch ? effectiveWeights.propertyMatch : 0;
  breakdown.push({ factor: "Property match", points: matchPts, max: effectiveWeights.propertyMatch });

  const visitPts = inputs.siteVisitInterest ? effectiveWeights.siteVisitInterest : 0;
  breakdown.push({ factor: "Site visit interest", points: visitPts, max: effectiveWeights.siteVisitInterest });

  const financePts = inputs.loanRequired != null ? effectiveWeights.financingReadiness : 0;
  breakdown.push({ factor: "Financing readiness", points: financePts, max: effectiveWeights.financingReadiness });

  const responsePts = inputs.respondedQuickly ? effectiveWeights.responseBehavior : 0;
  breakdown.push({ factor: "Response behavior", points: responsePts, max: effectiveWeights.responseBehavior });

  const score = Math.round(breakdown.reduce((sum, b) => sum + (Number.isFinite(b.points) ? b.points : 0), 0));
  const clamped = Math.max(0, Math.min(100, score));

  const temperature: ScoreResult["temperature"] = clamped >= effectiveThresholds.hot ? "HOT" : clamped >= effectiveThresholds.warm ? "WARM" : "COLD";

  return { score: clamped, temperature, breakdown };
}

/** Parses common Indian-English/Hinglish timeline phrases into a day count. */
export function parseTimelineToDays(timeline?: string | null): number | null {
  if (!timeline) return null;
  const t = timeline.toLowerCase();
  const monthMatch = t.match(/(\d+)\s*month/);
  const dayMatch = t.match(/(\d+)\s*day/);
  const weekMatch = t.match(/(\d+)\s*week/);
  if (dayMatch) return parseInt(dayMatch[1], 10);
  if (weekMatch) return parseInt(weekMatch[1], 10) * 7;
  if (monthMatch) return parseInt(monthMatch[1], 10) * 30;
  if (t.includes("immediate") || t.includes("asap") || t.includes("urgent")) return 7;
  if (t.includes("this month")) return 20;
  if (t.includes("next month")) return 45;
  return null;
}

export interface ScoredMessage {
  sender: string;
  createdAt: string;
}

/**
 * Response-behaviour signal: did the conversation get answered in time?
 *
 * - No lead messages yet → true (nothing has been missed).
 * - A lead message answered within 24h counts as answered.
 * - A lead message with no reply that is older than 24h counts as missed.
 * - A lead message still waiting for a reply (< 24h) is ignored — the
 *   conversation may simply be open right now.
 *
 * Returns true when at least half of the judged messages were answered.
 */
export function answeredQuickly(messages: ScoredMessage[], nowMs: number = Date.now()): boolean {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const leadMessages = sorted.filter((m) => m.sender === "LEAD");
  if (leadMessages.length === 0) return true;

  const outboundTimes = sorted
    .filter((m) => m.sender === "AI" || m.sender === "AGENT")
    .map((m) => new Date(m.createdAt).getTime());

  let judged = 0;
  let answered = 0;
  for (const message of leadMessages) {
    const at = new Date(message.createdAt).getTime();
    const reply = outboundTimes.find((t) => t >= at);
    if (reply == null) {
      if (nowMs - at > 24 * 3_600_000) judged++;
      continue;
    }
    judged++;
    if (reply - at <= 24 * 3_600_000) answered++;
  }
  if (judged === 0) return true;
  return answered / judged >= 0.5;
}

export interface LeadScoreState {
  budgetMinInr?: number | null;
  budgetMaxInr?: number | null;
  preferredCity?: string | null;
  bhk?: number | null;
  propertyType?: string | null;
  timeline?: string | null;
  siteVisitInterest?: boolean | null;
  loanRequired?: boolean | null;
  /** Number of inbound (lead) messages across all of the lead's conversations. */
  leadMessageCount: number;
  /** True when at least one saved or freshly computed EXACT/CLOSE property match exists. */
  hasPropertyMatch: boolean;
  /** Full message history (all senders) — used for the response-speed factor. */
  messages?: ScoredMessage[];
}

/**
 * Builds scoring inputs from PERSISTED lead state rather than from whatever
 * the current conversation turn happened to extract. This is what keeps the
 * score stable: a "hello" message can no longer erase a property match that
 * was already recorded, and manual/imported leads can be scored identically
 * to AI-qualified ones.
 */
export function buildScoringInputs(state: LeadScoreState): ScoringInputs {
  return {
    hasBudget: Boolean(state.budgetMinInr || state.budgetMaxInr),
    hasLocation: Boolean(state.preferredCity),
    hasBhkOrType: Boolean(state.bhk || state.propertyType),
    timelineWithinDays: parseTimelineToDays(state.timeline),
    engagementMessageCount: Math.max(0, state.leadMessageCount),
    hasPropertyMatch: state.hasPropertyMatch,
    siteVisitInterest: state.siteVisitInterest ?? null,
    loanRequired: state.loanRequired ?? null,
    respondedQuickly: state.messages ? answeredQuickly(state.messages) : true,
  };
}
