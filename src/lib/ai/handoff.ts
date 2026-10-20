import "server-only";

export interface HandoffCheckInput {
  latestLeadMessage: string;
  leadScore: number;
  hotThreshold: number;
  aiConfidence: "confident" | "uncertain"; // set by the conversation agent based on whether it found grounded data
  sentimentFlag: "neutral" | "frustrated";
  requestsNegotiationOrCustomPrice: boolean;
  requestsHuman: boolean;
}

export interface HandoffResult {
  shouldHandoff: boolean;
  reason?: string;
}

const HUMAN_REQUEST_PATTERNS = [
  /\btalk to (a |an )?(agent|human|person|salesperson|manager)\b/i,
  /\bcall me\b/i,
  /\bcan (i|someone) speak to\b/i,
  /\bconnect me\b/i,
  /\breal (agent|person)\b/i,
];

const LEGAL_SENSITIVE_PATTERNS = [
  /\b(litigation|dispute|court|lawsuit|title deed|encumbrance|legal notice|rera complaint)\b/i,
];

const SITE_VISIT_PATTERNS = [
  /\bsite visit\b/i,
  /\bvisit (?:the |this )?(?:property|project|flat|home)\b/i,
  /\b(?:schedule|book|arrange) (?:a )?visit\b/i,
];

export function detectsHumanRequest(message: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((p) => p.test(message));
}

export function detectsLegalSensitive(message: string): boolean {
  return LEGAL_SENSITIVE_PATTERNS.some((p) => p.test(message));
}

/**
 * Central escalation policy (Section 16). Deliberately rule-based rather
 * than left to the LLM's judgment alone, since handoff correctness has
 * direct business consequences (a missed hot lead, or an unnecessary
 * interruption to a salesperson).
 */
export function checkHandoff(input: HandoffCheckInput): HandoffResult {
  if (input.requestsHuman || detectsHumanRequest(input.latestLeadMessage)) {
    return { shouldHandoff: true, reason: "Lead explicitly asked to speak with a person" };
  }
  if (detectsLegalSensitive(input.latestLeadMessage)) {
    return { shouldHandoff: true, reason: "Legal/sensitive topic requires human judgment" };
  }
  if (input.requestsNegotiationOrCustomPrice) {
    return { shouldHandoff: true, reason: "Price negotiation requires sales approval" };
  }
  if (SITE_VISIT_PATTERNS.some((pattern) => pattern.test(input.latestLeadMessage))) {
    return { shouldHandoff: true, reason: "Site visit requires sales coordination" };
  }
  if (input.leadScore >= input.hotThreshold && input.leadScore > 0) {
    return { shouldHandoff: true, reason: "Lead has reached HOT qualification threshold" };
  }
  if (input.sentimentFlag === "frustrated") {
    return { shouldHandoff: true, reason: "Customer appears frustrated" };
  }

  // Missing verified data during a normal qualification flow is NOT a human-handoff event.
  // Keep the conversation alive and ask for the next missing detail instead.
  return { shouldHandoff: false };
}
