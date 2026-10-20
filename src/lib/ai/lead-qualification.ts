import "server-only";

/**
 * LEAD QUALIFICATION — converts the deterministic score + requirement
 * completeness + engagement into a sales-meaningful STAGE, and decides which
 * (if any) lead-status promotion is safe to write back.
 *
 * Reuses the existing lead/score architecture: score & temperature still come
 * from `scoreLead()` (lead-scoring.ts) and stages map onto the existing
 * `leads.status` / `leads.temperature` columns. Nothing here invents a
 * separate CRM, and status moves are promotion-only so existing pipeline data
 * is never destroyed.
 */

export type LeadStage = "NEW_LEAD" | "LOW_INTENT" | "INTERESTED" | "QUALIFIED" | "HOT_LEAD" | "SITE_VISIT_READY";

export type LeadStatus =
  | "NEW"
  | "CONTACTED"
  | "QUALIFIED"
  | "INTERESTED"
  | "SITE_VISIT_SCHEDULED"
  | "NEGOTIATION"
  | "CONVERTED"
  | "LOST"
  | "NURTURE";

export interface QualificationInput {
  score: number;
  temperature: "HOT" | "WARM" | "COLD";
  status: LeadStatus | string;
  engagementMessageCount: number;
  requirementsComplete: boolean;
  matchedPropertyCount: number;
  hasExactMatch: boolean;
  siteVisitInterest: boolean;
}

export interface QualificationResult {
  stage: LeadStage;
  /** Short reason a salesperson can act on. */
  rationale: string;
  /** The next best step in the sales path:
   *  recommendation → details → shortlist → site visit → human agent. */
  nextAction: string;
}

const DEFAULT_WARM_THRESHOLD = 50;

/** Statuses that already sit at or beyond the AI's authority — never moved. */
const PROTECTED_STATUSES: ReadonlySet<string> = new Set([
  "QUALIFIED",
  "INTERESTED",
  "SITE_VISIT_SCHEDULED",
  "NEGOTIATION",
  "CONVERTED",
  "LOST",
  "NURTURE",
]);

export function qualifyLead(input: QualificationInput, warmThreshold = DEFAULT_WARM_THRESHOLD): QualificationResult {
  const { score, temperature, engagementMessageCount, requirementsComplete, matchedPropertyCount, siteVisitInterest } = input;

  if (siteVisitInterest && matchedPropertyCount > 0) {
    return {
      stage: "SITE_VISIT_READY",
      rationale: "Asked for a site visit and matching inventory exists",
      nextAction: "Confirm a visit slot with a property specialist",
    };
  }

  if (temperature === "HOT") {
    return {
      stage: "HOT_LEAD",
      rationale: `Score ${score}/100 — high buying intent`,
      nextAction: "Have a specialist call now and send the shortlist",
    };
  }

  if (requirementsComplete && score >= warmThreshold) {
    return {
      stage: "QUALIFIED",
      rationale: "Budget, location and requirement are clear with enough intent signals",
      nextAction: "Send a property shortlist and offer a site visit",
    };
  }

  if (matchedPropertyCount > 0 || score >= warmThreshold) {
    return {
      stage: "INTERESTED",
      rationale: matchedPropertyCount > 0 ? "Matching inventory found — still completing requirements" : "Intent signals are strong but requirements are incomplete",
      nextAction: "Ask the next missing requirement, then recommend options",
    };
  }

  if (engagementMessageCount >= 3) {
    return {
      stage: "INTERESTED",
      rationale: "Actively conversing but requirements are not yet actionable",
      nextAction: "Ask for budget or timeline to move toward qualification",
    };
  }

  if (input.status === "NEW" && !requirementsComplete && score < warmThreshold && engagementMessageCount <= 1) {
    return {
      stage: "NEW_LEAD",
      rationale: "First contact — nothing captured yet",
      nextAction: "Greet, understand buy/rent intent and capture location",
    };
  }

  if (!requirementsComplete && score < warmThreshold) {
    return {
      stage: "LOW_INTENT",
      rationale: "Low score with incomplete requirements",
      nextAction: "Ask one qualifying question; nurture if there is no reply",
    };
  }

  return {
    stage: "INTERESTED",
    rationale: "Engaged with partial requirements",
    nextAction: "Complete the requirement, then send matching options",
  };
}

/**
 * Promotion-only status transitions. The AI may move NEW → CONTACTED →
 * QUALIFIED; every other status (including anything a human or an
 * appointment already set) is left untouched so pipeline history survives.
 */
export function promoteLeadStatus(currentStatus: string, stage: LeadStage): LeadStatus | string {
  if (PROTECTED_STATUSES.has(currentStatus)) return currentStatus;
  if (stage === "QUALIFIED" || stage === "SITE_VISIT_READY") return "QUALIFIED";
  if (currentStatus === "NEW") return "CONTACTED";
  return currentStatus;
}

/** Stage label for dashboards/summaries, e.g. "HOT LEAD". */
export function stageLabel(stage: LeadStage): string {
  return stage.replace("_", " ");
}
