import "server-only";
import { callClaude, aiIsConfigured } from "./claude-client";

export interface ExtractedRequirements {
  preferredCity?: string;
  preferredLocality?: string;
  propertyType?: "APARTMENT" | "VILLA" | "PLOT" | "INDEPENDENT_HOUSE" | "COMMERCIAL";
  bhk?: number;
  budgetMinInr?: number;
  budgetMaxInr?: number;
  purpose?: "BUY" | "RENT" | "INVEST";
  timeline?: string;
  loanRequired?: boolean;
  siteVisitInterest?: boolean;
  name?: string;
  phone?: string;
  email?: string;
}

const EXTRACTION_SYSTEM = `You extract structured real-estate lead requirements from a customer message, which may be in English, Hindi, or Hinglish (mixed).
Return ONLY a compact JSON object (no prose, no markdown fences) with any of these keys you are confident about, omitting keys you cannot infer:
preferredCity, preferredLocality, propertyType (one of APARTMENT, VILLA, PLOT, INDEPENDENT_HOUSE, COMMERCIAL), bhk (integer), budgetMinInr, budgetMaxInr (numbers in rupees — convert "lakh" to *100000 and "crore" to *10000000), purpose (BUY, RENT, INVEST), timeline (short string), loanRequired (boolean), siteVisitInterest (boolean), name, phone, email.
Never invent values not implied by the message. If nothing can be extracted, return {}.`;

/** Simple regex fallback used when no Claude API key is configured, so
 * qualification still functions (with reduced accuracy) in demo/offline mode. */
function ruleBasedExtract(message: string): ExtractedRequirements {
  const out: ExtractedRequirements = {};
  const lower = message.toLowerCase();

  const bhkMatch = lower.match(/(\d)\s*-?\s*bhk/);
  if (bhkMatch) out.bhk = parseInt(bhkMatch[1], 10);

  const lakhMatch = lower.match(/(\d+(?:\.\d+)?)\s*lakh/);
  const croreMatch = lower.match(/(\d+(?:\.\d+)?)\s*crore/);
  if (croreMatch) out.budgetMaxInr = Math.round(parseFloat(croreMatch[1]) * 10000000);
  else if (lakhMatch) out.budgetMaxInr = Math.round(parseFloat(lakhMatch[1]) * 100000);

  const cities = ["noida", "greater noida", "gurgaon", "gurugram", "delhi", "ghaziabad", "faridabad", "mumbai", "pune", "bangalore", "bengaluru"];
  const foundCity = cities.find((c) => lower.includes(c));
  if (foundCity) out.preferredCity = foundCity.replace(/\b\w/g, (c) => c.toUpperCase());

  if (/\brent\b|\bkiraye\b/.test(lower)) out.purpose = "RENT";
  else if (/\binvest/.test(lower)) out.purpose = "INVEST";
  else if (/\bbuy\b|\bkharidna\b|\bkharidna hai\b/.test(lower)) out.purpose = "BUY";

  if (/\bloan\b/.test(lower)) out.loanRequired = true;
  if (/site visit|visit karna|dekhna hai/.test(lower)) out.siteVisitInterest = true;

  const timelineMatch = lower.match(/(within|in)\s+\d+\s*(day|week|month)s?/);
  if (timelineMatch) out.timeline = timelineMatch[0];
  else if (/immediate|asap|urgent/.test(lower)) out.timeline = "immediate";

  return out;
}

export async function extractRequirements(message: string): Promise<ExtractedRequirements> {
  if (!aiIsConfigured()) return ruleBasedExtract(message);

  try {
    const { text } = await callClaude({
      system: EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: message }],
      maxTokens: 300,
    });
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned || "{}");
  } catch {
    // Never let extraction failures break the conversation — fall back.
    return ruleBasedExtract(message);
  }
}
