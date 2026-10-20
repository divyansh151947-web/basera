import "server-only";
import { formatBudgetRange } from "@/lib/formatters";

export interface SummaryInputs {
  name?: string | null;
  score: number;
  temperature: "HOT" | "WARM" | "COLD";
  bhk?: number | null;
  preferredCity?: string | null;
  preferredLocality?: string | null;
  budgetMinInr?: number | null;
  budgetMaxInr?: number | null;
  timeline?: string | null;
  loanRequired?: boolean | null;
  siteVisitInterest?: boolean | null;
  purpose?: string | null;
}

/**
 * Template-based summary (no AI call required) so this always works, is
 * fast, free, and never hallucinates — matches the format specified in
 * Section 12. Every field shown is copied directly from stored lead data.
 */
export function generateLeadSummary(input: SummaryInputs): string {
  const budget =
    input.budgetMinInr != null || input.budgetMaxInr != null
      ? formatBudgetRange(input.budgetMinInr, input.budgetMaxInr)
      : "Not specified";

  const lines = [
    `${input.temperature} LEAD — ${input.score}/100`,
    "",
    `Name: ${input.name ?? "Unknown"}`,
    `Requirement: ${input.bhk ? `${input.bhk} BHK` : "Not specified"}${input.purpose ? ` (${input.purpose.toLowerCase()})` : ""}`,
    `Location: ${[input.preferredLocality, input.preferredCity].filter(Boolean).join(", ") || "Not specified"}`,
    `Budget: ${budget}`,
    `Timeline: ${input.timeline ?? "Not specified"}`,
    `Loan: ${input.loanRequired == null ? "Unknown" : input.loanRequired ? "Required" : "Not required"}`,
    `Site Visit: ${input.siteVisitInterest ? "Interested" : "Not yet confirmed"}`,
    "",
    `AI Summary: Customer is ${input.temperature === "HOT" ? "actively" : input.temperature === "WARM" ? "moderately" : "casually"} looking${
      input.bhk ? ` for a ${input.bhk} BHK` : ""
    }${input.preferredCity ? ` in ${input.preferredCity}` : ""}${input.siteVisitInterest ? " and appears ready to visit suitable properties." : "."}`,
  ];

  return lines.join("\n");
}
