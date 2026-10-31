import "server-only";

/**
 * RECOVERY AI EXPLANATION (Feature 1).
 *
 * Grounded, explainable recovery recommendations for at-risk leads. Reuses
 * the existing recovery engine's single-lead decision and the shared AI
 * provider (ai-provider.ts) — no duplicate provider config, no Voice AI
 * dependency.
 *
 * When the AI provider is unavailable or returns empty output, a
 * deterministic fallback names only the facts on record — never inventing
 * conversations, people, or outcomes.
 */

/** Deterministic fallback explanation when the AI provider is unavailable.
 *  Names only the facts on record — never invents conversations or people. */
export function fallbackExplanation(facts: {
  leadName: string | null;
  riskLevel: string;
  riskScore: number;
  leadScore: number;
  lastInboundHoursAgo: number | null;
  recommendedAction: string | null;
  reasons: string[];
}): string {
  const parts: string[] = [];
  parts.push(`${facts.leadName ?? "This lead"} is scored ${facts.leadScore}/100 with ${facts.riskLevel.toLowerCase()} revenue risk (${facts.riskScore}/100).`);
  if (facts.lastInboundHoursAgo != null) {
    parts.push(`The customer last wrote in ${Math.round(facts.lastInboundHoursAgo)} hours ago.`);
  } else {
    parts.push("There is no recorded customer message on file.");
  }
  if (facts.recommendedAction) {
    parts.push(`Recommended next step: ${facts.recommendedAction.replace(/_/g, " ").toLowerCase()}.`);
  }
  if (facts.reasons.length > 0) {
    parts.push(`Why: ${facts.reasons.slice(0, 2).join(" ")}`);
  }
  return parts.join(" ");
}

export interface RecoveryExplanationFacts {
  leadName: string | null;
  riskLevel: string;
  riskScore: number;
  leadScore: number;
  lastInboundHoursAgo: number | null;
  recommendedAction: string | null;
  reasons: string[];
}

export function buildRecoveryExplanationPrompt(facts: RecoveryExplanationFacts): string {
  return `Lead facts (recorded CRM data only):\n` +
    `- Lead: ${facts.leadName ?? "unnamed"}\n` +
    `- Lead score: ${facts.leadScore}/100 · Revenue risk: ${facts.riskLevel} (${facts.riskScore}/100)\n` +
    `- Last customer contact: ${facts.lastInboundHoursAgo == null ? "none on record" : Math.round(facts.lastInboundHoursAgo) + " hours ago"}\n` +
    `- Recommended action: ${facts.recommendedAction ?? "none — monitor"}\n` +
    `- Supporting reasons: ${facts.reasons.join("; ") || "none recorded"}\n`;
}

export const RECOVERY_EXPLANATION_SYSTEM =
  "You are a careful real-estate sales analyst. Write a plain-language recovery recommendation of 2-4 sentences. " +
  "Use ONLY the facts provided below. Do not invent conversations, phone numbers, personal details, or outcomes. " +
  "If a fact is absent, say so. Do not promise that the lead will convert. Do not suggest sending an email or message " +
  "automatically; frame everything as a suggested action for the agent to review.";
