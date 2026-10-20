import "server-only";
import { parseTimelineToDays } from "./lead-scoring";

/**
 * LEAD UNDERSTANDING — the structured view of what a conversation has
 * revealed about a buyer, derived ONLY from data the customer actually said
 * (never invented). It powers:
 *   1. the requirement profile shown in the system prompt (so the LLM stops
 *      re-asking for things it already knows),
 *   2. the lead summary salespeople read,
 *   3. completeness checks that decide when enough is known to match
 *      properties and ask the next best question.
 *
 * Pure module: no DB, no AI call — safe to unit test on its own.
 */

export type RequirementField = "location" | "budget" | "bedrooms" | "propertyType" | "purpose" | "timeline";
export type PropertyCategory = "RESIDENTIAL" | "COMMERCIAL";
export type BuyerIntent = "BUYER" | "RENTER" | "INVESTOR";
export type UrgencyLevel = "IMMEDIATE" | "SOON" | "FLEXIBLE" | "EXPLORING" | "UNKNOWN";
export type ObjectionLabel = "PRICE" | "LOCATION" | "TIMING" | "TRUST" | "FAMILY_ADVICE";

export interface LeadUnderstanding {
  propertyCategory: PropertyCategory | null;
  buyerIntent: BuyerIntent | null;
  purposeLabel: string | null;
  bedrooms: number | null;
  locationLabel: string | null;
  budgetMinInr: number | null;
  budgetMaxInr: number | null;
  budgetLabel: string | null;
  timeline: string | null;
  urgency: UrgencyLevel;
  known: RequirementField[];
  missing: RequirementField[];
  missingPriority: RequirementField[];
  isComplete: boolean;
  objections: ObjectionLabel[];
  preferences: string[];
}

/** Priority order for "what should we ask next" — location first, because a
 *  search without a place cannot be answered at all. */
const MISSING_PRIORITY: RequirementField[] = ["location", "budget", "bedrooms", "propertyType", "purpose", "timeline"];

export function formatInrShort(value: number): string {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2).replace(/\.?0+$/, "")} crore`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1).replace(/\.0$/, "")} lakh`;
  return `₹${value}`;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatBudgetLabel(min: number | null, max: number | null): string | null {
  if (min != null && max != null) {
    if (min === max) return formatInrShort(max);
    return `${formatInrShort(min)}–${formatInrShort(max)}`;
  }
  if (max != null) return `up to ${formatInrShort(max)}`;
  if (min != null) return `from ${formatInrShort(min)}`;
  return null;
}

const COMMERCIAL_SIGNALS = /\b(office|shop|showroom|retail|commercial|godown|warehouse|shop cum office|sco|coworking|co-working|industrial plot|factory)\b/i;
const RESIDENTIAL_SIGNALS = /\b(bhk|bedroom|flat|apartment|villa|house|home|residential|penthouse|duplex)\b/i;

const PROPERTY_TYPE_CATEGORY: Record<string, PropertyCategory> = {
  APARTMENT: "RESIDENTIAL",
  VILLA: "RESIDENTIAL",
  PLOT: "RESIDENTIAL",
  INDEPENDENT_HOUSE: "RESIDENTIAL",
  COMMERCIAL: "COMMERCIAL",
};

/** Objections a real-estate buyer raises, in English, Hindi and Hinglish.
 *  Checked against the RAW message because normalizeInput() strips
 *  Devanagari. */
const OBJECTION_PATTERNS: Array<{ label: ObjectionLabel; pattern: RegExp }> = [
  { label: "PRICE", pattern: /\b(expensive|costly|overpriced|pricey|too much|not in my budget|budget kam|zyada|jhagada)\b|महंगा|महँगा|महंगी|कीमत|मूल्य|ज़्यादा|ज्यादा/i },
  { label: "LOCATION", pattern: /\b(too far|far from|wrong location|location is not|area nahi|door hai)\b|दूर|जगह ठीक नहीं/i },
  { label: "TIMING", pattern: /\b(not now|later|baad me|baad mein|after some time|not ready|rethink|think about it)\b|अभी नहीं|बाद में|सोच कर/i },
  { label: "TRUST", pattern: /\b(scam|fraud|fake|suspicious|legit|genuine|verified|trust)\b|धोखा|फर्जी|भरोसा/i },
  { label: "FAMILY_ADVICE", pattern: /\b(ask my|ask family|consult|discuss with|take opinion|talk to family|wife se|family se)\b|परिवार|घरवालों|पत्नी/i },
];

const PREFERENCE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Ready to move", pattern: /\b(ready to move|ready-to-move|possession ready|immediate possession)\b|तैयार मकान/i },
  { label: "Home loan", pattern: /\b(home loan|loan|emi|financ(e|ing)|mortgage)\b|लोन/i },
  { label: "Parking", pattern: /\b(parking|car park|covered parking|stilt)\b/i },
  { label: "Furnished", pattern: /\b(furnished|furniture)\b|सामान सहित/i },
  { label: "Gated security", pattern: /\b(gated|security|24x7|24\*7)\b/i },
  { label: "Vastu", pattern: /\b(vastu|vaastu|vastu shastra)\b|वास्तु/i },
  { label: "Near schools", pattern: /\b(near school|near schools|schools nearby|near hospital|kids school)\b|स्कूल के पास/i },
  { label: "Low maintenance", pattern: /\b(low maintenance|maintenance kam)\b/i },
];

export function detectObjections(message: string): ObjectionLabel[] {
  const found: ObjectionLabel[] = [];
  for (const { label, pattern } of OBJECTION_PATTERNS) {
    if (pattern.test(message) && !found.includes(label)) found.push(label);
  }
  return found;
}

export function detectPreferences(message: string): string[] {
  const found: string[] = [];
  for (const { label, pattern } of PREFERENCE_PATTERNS) {
    if (pattern.test(message) && !found.includes(label)) found.push(label);
  }
  return found;
}

function deriveUrgency(timeline: string | null, message: string): UrgencyLevel {
  const raw = `${timeline ?? ""} ${message}`.toLowerCase();
  if (/\b(just looking|just browsing|exploring|researching|sirf dekh raha|keval dekh)\b/.test(raw)) return "EXPLORING";
  const days = timeline ? parseTimelineToDays(timeline) : null;
  if (days != null) {
    if (days <= 30) return "IMMEDIATE";
    if (days <= 90) return "SOON";
    return "FLEXIBLE";
  }
  if (/\b(asap|urgent|immediate|this week|jaldi|turant|turant hi|right away|very soon)\b|जल्दी|तुरंत|अभी/.test(raw)) return "IMMEDIATE";
  if (/\b(soon|next month|couple of months|few months|3 months|6 months)\b|जल्द/.test(raw)) return "SOON";
  if (timeline) return "FLEXIBLE";
  return "UNKNOWN";
}

/**
 * Builds the structured requirement profile from the merged lead fields plus
 * (optionally) the raw incoming message, which is where soft signals such as
 * objections, preferences and urgency live.
 */
export function buildLeadUnderstanding(
  merged: Record<string, unknown>,
  opts: { message?: string } = {}
): LeadUnderstanding {
  const message = opts.message ?? "";
  const purpose = str(merged.purpose)?.toUpperCase() ?? null;
  const propertyType = str(merged.propertyType)?.toUpperCase() ?? null;
  const bedrooms = num(merged.bhk);
  const budgetMin = num(merged.budgetMinInr);
  const budgetMax = num(merged.budgetMaxInr);
  const city = str(merged.preferredCity);
  const locality = str(merged.preferredLocality);
  const timeline = str(merged.timeline);

  const locationLabel = [locality, city].filter(Boolean).join(", ") || null;

  let propertyCategory: PropertyCategory | null = propertyType ? (PROPERTY_TYPE_CATEGORY[propertyType] ?? null) : null;
  if (!propertyCategory && COMMERCIAL_SIGNALS.test(message)) propertyCategory = "COMMERCIAL";
  if (!propertyCategory && (bedrooms != null || (message && RESIDENTIAL_SIGNALS.test(message)))) propertyCategory = "RESIDENTIAL";

  let buyerIntent: BuyerIntent | null = null;
  if (purpose === "BUY") buyerIntent = "BUYER";
  else if (purpose === "RENT") buyerIntent = "RENTER";
  else if (purpose === "INVEST") buyerIntent = "INVESTOR";
  else if (message) {
    if (/\b(rent|rental|kiraaye|kiraye|lease|किराया|किराये)\b/i.test(message)) buyerIntent = "RENTER";
    else if (/\b(invest|investment|nivesh|निवेश)\b/i.test(message)) buyerIntent = "INVESTOR";
    else if (/\b(buy|purchase|khareed|खरीद|for my family|for myself|self use)\b/i.test(message)) buyerIntent = "BUYER";
  }

  const purposeLabel =
    purpose === "BUY" ? "Self-use" : purpose === "RENT" ? "Rent" : purpose === "INVEST" ? "Investment" : null;

  const known: RequirementField[] = [];
  if (locationLabel) known.push("location");
  if (budgetMin != null || budgetMax != null) known.push("budget");
  if (bedrooms != null) known.push("bedrooms");
  if (propertyType) known.push("propertyType");
  if (purpose) known.push("purpose");
  if (timeline) known.push("timeline");

  const missing = MISSING_PRIORITY.filter((f) => !known.includes(f));
  const missingPriority = missing.slice();

  return {
    propertyCategory,
    buyerIntent,
    purposeLabel,
    bedrooms,
    locationLabel,
    budgetMinInr: budgetMin,
    budgetMaxInr: budgetMax,
    budgetLabel: formatBudgetLabel(budgetMin, budgetMax),
    timeline,
    urgency: deriveUrgency(timeline ?? null, message),
    known,
    missing,
    missingPriority,
    // A requirement is actionable when we know where, how much and what size
    // (property type can stand in for bedrooms — a VILLA search is clear).
    isComplete: Boolean(locationLabel && (budgetMin != null || budgetMax != null) && (bedrooms != null || propertyType)),
    objections: detectObjections(message),
    preferences: detectPreferences(message),
  };
}

/** One dense line describing the requirement — used in the system prompt and
 *  the lead summary so nobody (human or model) has to re-derive it. */
export function formatUnderstandingLine(u: LeadUnderstanding): string {
  const parts: string[] = [];
  if (u.propertyCategory) parts.push(u.propertyCategory === "RESIDENTIAL" ? "Residential" : "Commercial");
  if (u.bedrooms != null) parts.push(`${u.bedrooms} BHK`);
  else if (u.purposeLabel === "Rent") parts.push("Rent");
  if (u.locationLabel) parts.push(u.locationLabel);
  if (u.budgetLabel) parts.push(u.budgetLabel);
  if (u.purposeLabel) parts.push(u.purposeLabel);
  if (u.buyerIntent) parts.push(u.buyerIntent === "BUYER" ? "Buyer" : u.buyerIntent === "RENTER" ? "Renter" : "Investor");
  if (u.timeline) parts.push(u.timeline);
  return parts.join(" · ");
}

/** Human-readable "what's still missing", in ask order. */
export function formatMissingRequirements(missing: RequirementField[]): string {
  const labels: Record<RequirementField, string> = {
    location: "location",
    budget: "budget",
    bedrooms: "bedrooms",
    propertyType: "property type",
    purpose: "purpose (buy/rent)",
    timeline: "timeline",
  };
  return missing.map((f) => labels[f]).join(", ");
}
