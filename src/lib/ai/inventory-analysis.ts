import "server-only";

/**
 * INVENTORY GAP ANALYSIS — answers one honest question when a strict search
 * returns nothing: WHY did it return nothing, based on the organisation's
 * REAL property rows?
 *
 *   • the requested city has no inventory at all  → say so (and offer the
 *     cities that do have inventory),
 *   • inventory exists but nothing fits the budget → quote the real starting price,
 *   • budget fits but the BHK/type doesn't         → list the BHKs that exist,
 *   • everything fits but not in the asked locality → offer the localities that do.
 *
 * Pure module: no DB access, so the ladder is unit-testable with fixture rows.
 */

export type GapLanguage = "en" | "hi" | "hinglish";

export interface InventoryProperty {
  city: string;
  locality: string;
  bhk: number | null;
  propertyType: string | null;
  priceMinInr: number;
  priceMaxInr: number;
  availability: string;
  isArchived?: boolean;
  projectName?: string;
}

export interface InventoryCriteria {
  preferredCity?: string | null;
  preferredLocality?: string | null;
  bhk?: number | null;
  propertyType?: string | null;
  budgetMinInr?: number | null;
  budgetMaxInr?: number | null;
}

export interface InventoryGap {
  requestedCity: string | null;
  requestedLocality: string | null;
  /** Active listings in the requested city (or org-wide when no city given). */
  cityCount: number;
  totalActiveCount: number;
  /** Cities that DO have inventory, sorted — never invented. */
  cities: string[];
  /** Localities inside the city that have inventory within budget. */
  localities: string[];
  /** Distinct BHK options inside the city that fit the budget. */
  bhkOptions: number[];
  /** Cheapest entry price for a city listing matching BHK/type (any budget). */
  cheapestMatchingRequirementInr: number | null;
  /** Counts along the relaxation ladder. */
  localityFitCount: number;
  bhkFitCount: number;
  budgetFitCount: number;
}

function norm(value?: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
}

function isActive(p: InventoryProperty): boolean {
  if (p.isArchived) return false;
  if (p.availability === "SOLD_OUT") return false;
  return true;
}

function matchesCity(p: InventoryProperty, city: string): boolean {
  const pc = norm(p.city);
  return Boolean(pc && (pc === city || pc.includes(city) || city.includes(pc)));
}

function matchesLocality(p: InventoryProperty, locality: string): boolean {
  const pl = norm(p.locality);
  return Boolean(pl && (pl === locality || pl.includes(locality) || locality.includes(pl)));
}

function fitsBudget(p: InventoryProperty, criteria: InventoryCriteria): boolean {
  if (criteria.budgetMaxInr != null && p.priceMaxInr > criteria.budgetMaxInr) return false;
  if (criteria.budgetMinInr != null && p.priceMinInr < criteria.budgetMinInr) return false;
  return true;
}

function fitsRequirement(p: InventoryProperty, criteria: InventoryCriteria): boolean {
  if (criteria.bhk != null && (p.bhk == null || p.bhk !== criteria.bhk)) return false;
  if (criteria.propertyType && p.propertyType !== criteria.propertyType) return false;
  return true;
}

export function analyzeInventoryGap(allProperties: InventoryProperty[], criteria: InventoryCriteria): InventoryGap {
  const active = allProperties.filter(isActive);
  const city = norm(criteria.preferredCity);
  const locality = norm(criteria.preferredLocality);

  const inCity = city ? active.filter((p) => matchesCity(p, city)) : active;

  const budgetFit = inCity.filter((p) => fitsBudget(p, criteria));
  const bhkFit = budgetFit.filter((p) => fitsRequirement(p, criteria));
  const localityFit = locality ? bhkFit.filter((p) => matchesLocality(p, locality)) : bhkFit;

  const requirementFit = inCity.filter((p) => fitsRequirement(p, criteria));

  const uniqueSorted = (values: string[]) => Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort();
  const bhkOptions = Array.from(new Set(budgetFit.map((p) => p.bhk).filter((b): b is number => typeof b === "number"))).sort((a, b) => a - b);
  const localities = uniqueSorted(localityFit.length > 0 ? localityFit.map((p) => p.locality) : budgetFit.map((p) => p.locality));

  return {
    requestedCity: criteria.preferredCity ?? null,
    requestedLocality: criteria.preferredLocality ?? null,
    cityCount: inCity.length,
    totalActiveCount: active.length,
    cities: uniqueSorted(active.map((p) => p.city)),
    localities,
    bhkOptions,
    cheapestMatchingRequirementInr:
      requirementFit.length > 0 ? Math.min(...requirementFit.map((p) => p.priceMinInr)) : inCity.length > 0 ? Math.min(...inCity.map((p) => p.priceMinInr)) : null,
    localityFitCount: localityFit.length,
    bhkFitCount: bhkFit.length,
    budgetFitCount: budgetFit.length,
  };
}

function pick(lang: GapLanguage, en: string, hi: string, hinglish: string): string {
  if (lang === "hi") return hi;
  if (lang === "hinglish") return hinglish;
  return en;
}

function shortInr(value: number, lang: GapLanguage): string {
  if (value >= 10000000) {
    const c = (value / 10000000).toFixed(2).replace(/\.?0+$/, "");
    return lang === "hi" ? `₹${c} करोड़` : `₹${c} crore`;
  }
  const l = (value / 100000).toFixed(1).replace(/\.0$/, "");
  return lang === "hi" ? `₹${l} लाख` : `₹${l} lakh`;
}

function joinCities(cities: string[], lang: GapLanguage): string {
  const shown = cities.slice(0, 3);
  if (shown.length === 1) return shown[0];
  if (shown.length === 2) return pick(lang, `${shown[0]} and ${shown[1]}`, `${shown[0]} और ${shown[1]}`, `${shown[0]} aur ${shown[1]}`);
  const last = shown[shown.length - 1];
  return pick(lang, `${shown.slice(0, -1).join(", ")} and ${last}`, `${shown.slice(0, -1).join(", ")} और ${last}`, `${shown.slice(0, -1).join(", ")} aur ${last}`);
}

/**
 * Returns an honest, data-grounded reply for an empty strict search, or
 * `null` when the ladder cannot explain the miss (caller falls back to its
 * generic "no exact match" reply).
 */
export function buildInventoryGapReply(gap: InventoryGap, lang: GapLanguage = "en"): string | null {
  const city = gap.requestedCity;

  // 1. The business does not operate in the requested city at all.
  if (city && gap.cityCount === 0) {
    if (gap.cities.length === 0) {
      return pick(
        lang,
        "We don't have any verified listings in inventory right now. I've noted your requirement and a property specialist will follow up with options as they open up.",
        "अभी हमारे पास कोई वेरिफाइड लिस्टिंग नहीं है। मैंने आपकी ज़रूरत नोट कर ली है — प्रॉपर्टी स्पेशलिस्ट विकल्प आते ही संपर्क करेगा।",
        "Abhi hamare paas koi verified listing nahi hai. Maine aapki requirement note kar li hai — specialist options aate hi contact karega."
      );
    }
    return pick(
      lang,
      `I don't have verified listings in ${city} right now — our current inventory is in ${joinCities(gap.cities, lang)}. Want me to show those, or should I keep your ${city} requirement with a specialist?`,
      `${city} में अभी कोई वेरिफाइड लिस्टिंग नहीं है — हमारी मौजूदा इन्वेंट्री ${joinCities(gap.cities, lang)} में है। वही दिखाऊँ, या आपकी ${city} की ज़रूरत स्पेशलिस्ट के पास रखूँ?`,
      `${city} mein abhi koi verified listing nahi hai — current inventory ${joinCities(gap.cities, lang)} mein hai. Wahi dikhau, ya aapki ${city} requirement specialist ke paas rakhun?`
    );
  }

  // 2. Inventory exists but nothing fits the stated budget.
  if (gap.budgetFitCount === 0 && gap.cheapestMatchingRequirementInr != null) {
    const cheapest = shortInr(gap.cheapestMatchingRequirementInr, lang);
    const budgetText = city ?? pick(lang, "our inventory", "हमारी इन्वेंट्री", "hamari inventory");
    return pick(
      lang,
      `Within ${budgetText}, nothing matches yet — the closest options start at ${cheapest}. Want me to show those, or share a slightly different budget?`,
      `${budgetText} में अभी कुछ मैच नहीं करता — सबसे करीब विकल्प ${cheapest} से शुरू होते हैं। वही दिखाऊँ, या थोड़ा अलग बजट बताएँ?`,
      `${budgetText} mein abhi kuch match nahi karta — closest options ${cheapest} se shuru hote hain. Wahi dikhau, ya thoda alag budget batao?`
    );
  }

  // 3. Budget fits but the requested size/type does not exist in the city.
  if (gap.bhkFitCount === 0 && gap.budgetFitCount > 0) {
    const options = gap.bhkOptions.map((b) => `${b} BHK`).join(pick(lang, ", ", ", ", ", "));
    const where = city ?? pick(lang, "our inventory", "हमारी इन्वेंट्री", "hamari inventory");
    if (options) {
      return pick(
        lang,
        `In ${where} within your budget we currently have ${options} options. Shall I share those, or would you like a specialist to check availability for your exact size?`,
        `${where} में आपके बजट में अभी ${options} विकल्प हैं। वही भेजूँ, या स्पेशलिस्ट आपके साइज़ की उपलब्धता जाँचे?`,
        `${where} mein aapke budget mein abhi ${options} options hain. Wahi bhejun, ya specialist aapke exact size ki availability check kare?`
      );
    }
    return null;
  }

  // 4. Everything fits except the locality.
  if (gap.localityFitCount === 0 && gap.bhkFitCount > 0 && gap.requestedLocality) {
    const localities = gap.localities.slice(0, 3).join(pick(lang, ", ", ", ", ", "));
    const where = city ?? pick(lang, "this city", "इस शहर", "is shehar");
    if (localities) {
      return pick(
        lang,
        `Nothing specific in ${gap.requestedLocality} right now, but we do have matching options in ${localities} (${where}). Want me to share those?`,
        `${gap.requestedLocality} में अभी कुछ खास नहीं है, लेकिन ${localities} (${where}) में मैचिंग विकल्प हैं। वही भेजूँ?`,
        `${gap.requestedLocality} mein abhi kuch khaas nahi hai, lekin ${localities} (${where}) mein matching options hain. Wahi bhejun?`
      );
    }
  }

  return null;
}
