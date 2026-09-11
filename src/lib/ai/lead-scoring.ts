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
  const breakdown: ScoreResult["breakdown"] = [];

  const budgetPts = inputs.hasBudget ? weights.budgetClarity : 0;
  breakdown.push({ factor: "Budget clarity", points: budgetPts, max: weights.budgetClarity });

  const reqPts = (inputs.hasLocation ? 0.5 : 0) * weights.requirementClarity + (inputs.hasBhkOrType ? 0.5 : 0) * weights.requirementClarity;
  breakdown.push({ factor: "Requirement clarity", points: Math.round(reqPts), max: weights.requirementClarity });

  let timelinePts = 0;
  if (inputs.timelineWithinDays != null) {
    if (inputs.timelineWithinDays <= 30) timelinePts = weights.timeline;
    else if (inputs.timelineWithinDays <= 90) timelinePts = Math.round(weights.timeline * 0.6);
    else timelinePts = Math.round(weights.timeline * 0.25);
  }
  breakdown.push({ factor: "Buying timeline", points: timelinePts, max: weights.timeline });

  const engagementPts = Math.min(weights.engagement, inputs.engagementMessageCount * (weights.engagement / 6));
  breakdown.push({ factor: "Engagement", points: Math.round(engagementPts), max: weights.engagement });

  const matchPts = inputs.hasPropertyMatch ? weights.propertyMatch : 0;
  breakdown.push({ factor: "Property match", points: matchPts, max: weights.propertyMatch });

  const visitPts = inputs.siteVisitInterest ? weights.siteVisitInterest : 0;
  breakdown.push({ factor: "Site visit interest", points: visitPts, max: weights.siteVisitInterest });

  const financePts = inputs.loanRequired != null ? weights.financingReadiness : 0;
  breakdown.push({ factor: "Financing readiness", points: financePts, max: weights.financingReadiness });

  const responsePts = inputs.respondedQuickly ? weights.responseBehavior : 0;
  breakdown.push({ factor: "Response behavior", points: responsePts, max: weights.responseBehavior });

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.points, 0));
  const clamped = Math.max(0, Math.min(100, score));

  const temperature: ScoreResult["temperature"] = clamped >= thresholds.hot ? "HOT" : clamped >= thresholds.warm ? "WARM" : "COLD";

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
