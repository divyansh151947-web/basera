import "server-only";
import { callAI, aiIsConfigured } from "./ai-provider";

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
Types must match exactly: bhk is an integer, budgets are plain integers in rupees, booleans are true/false, everything else is a short string.
Never invent values not implied by the message. If nothing can be extracted, return {}.`;

const PROPERTY_TYPES = new Set(["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"]);
const PURPOSES = new Set(["BUY", "RENT", "INVEST"]);

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,\s₹]/g, "").toLowerCase();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceIntInRange(value: unknown, min: number, max: number): number | null {
  const n = coerceNumber(value);
  if (n == null) return null;
  const i = Math.round(n);
  return i >= min && i <= max ? i : null;
}

/** Budgets must survive the trip from model JSON to a DB column: numbers only,
 *  lakh shorthand normalised the same way parseContextualBudget does it, and
 *  an absolute ceiling so a hallucinated figure can never poison a lead row. */
function coerceBudgetInr(value: unknown): number | null {
  const n = coerceNumber(value);
  if (n == null || n <= 0) return null;
  let rupees = Math.round(n);
  if (rupees < 1000) rupees = Math.round(rupees * 100000);
  if (rupees < 1000 || rupees > 100000000000) return null;
  return rupees;
}

function coerceShortString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().replace(/\s+/g, " ");
  if (!s || s.length > max) return null;
  return s;
}

/** Simple regex fallback used when no Claude API key is configured, so
 * qualification still functions (with reduced accuracy) in demo/offline mode.
 *
 * Conversational tolerance (voice/STT realities): word-number BHK (English,
 * Roman Hindi, and Devanagari), Devanagari digits, and LAST-wins
 * self-correction ("3 BHK... actually 4", "Jaipur... sorry Gurgaon") are
 * handled here. Display text is never rewritten — only the extracted
 * structure prefers the latest correction. */
function ruleBasedExtract(message: string): ExtractedRequirements {
  const out: ExtractedRequirements = {};
  // Devanagari digits normalize to ASCII so downstream patterns just work.
  const lower = message.toLowerCase().replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));

  const bhk = parseBhkLast(lower);
  if (bhk != null) out.bhk = bhk;

  const budgetFromText = parseBudgetText(lower);
  if (budgetFromText) {
    if (budgetFromText.budgetMinInr) out.budgetMinInr = budgetFromText.budgetMinInr;
    if (budgetFromText.budgetMaxInr) out.budgetMaxInr = budgetFromText.budgetMaxInr;
  }

  const city = parseCityValue(lower);
  if (city) out.preferredCity = city;

  const locality = parseLocalityValue(lower);
  if (locality) out.preferredLocality = locality;

  const purpose = parsePurpose(lower);
  if (purpose) out.purpose = purpose;
  const propertyType = parsePropertyType(lower);
  if (propertyType) out.propertyType = propertyType;

  if (/loan|home loan|mortgage/.test(lower)) out.loanRequired = true;
  if (/site visit|visit karna|dekhna hai|visit to see|schedule a visit/.test(lower)) out.siteVisitInterest = true;
  // Short visit shorthand ("visit?", "want to visit", "site dekhna") — only
  // when it reads like a request, not a past-tense mention.
  if (!out.siteVisitInterest && /\b(visit|sight visit|site)\b/.test(lower) && /\b(want|karna|chahiye|schedule|book|weekend|possible|kab)\b/.test(lower)) {
    out.siteVisitInterest = true;
  }

  const timeline = parseTimeline(lower);
  if (timeline) out.timeline = timeline;

  const phoneMatch = lower.match(/\b(?:\+?91[-\s]?)?\d{10}\b/);
  if (phoneMatch) out.phone = phoneMatch[0].replace(/\D/g, "").slice(-10);

  const emailMatch = lower.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (emailMatch) out.email = emailMatch[0];

  return out;
}

/** Spoken BHK counts: English words, Roman-Hindi, and Devanagari. Only ever
 *  matched directly before a BHK unit word, so plain verbs like English "do"
 *  or Hindi "sath" (with) can never misfire on their own. */
const BHK_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, cheh: 6, chhah: 6,
  saat: 7, aath: 8, nau: 9, das: 10,
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5,
  "छह": 6, "छः": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
};

const BHK_WORD_PATTERN = Object.keys(BHK_WORDS)
  .sort((a, b) => b.length - a.length)
  .join("|");

const BHK_UNIT_PATTERN = String.raw`(?:bhk|bedrooms?|बीएचके)`;

/** Map a bare spoken count ("three", "teen", "तीन") to a BHK number for
 *  short answers ("How many bedrooms?" → "three"). Returns null unless the
 *  whole trimmed text is exactly one count word. */
export function parseWordBhk(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase();
  const value = BHK_WORDS[cleaned];
  return typeof value === "number" ? value : null;
}

/** BHK extraction with LAST-wins self-correction: every digit or word count
 *  next to a BHK unit is collected positionally and the latest one wins
 *  ("3 BHK... actually 4 BHK" → 4). */
function parseBhkLast(lower: string): number | null {
  const re = new RegExp(`(\\d+|${BHK_WORD_PATTERN})\\s*-?\\s*${BHK_UNIT_PATTERN}`, "gi");
  let last: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const raw = m[1];
    const value = /^\d+$/.test(raw) ? Number(raw) : (BHK_WORDS[raw.toLowerCase()] ?? null);
    if (value != null && value > 0) last = value;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return last;
}

function normalizeBudgetValue(raw: string): number | null {
  const cleaned = raw
    .replace(/[,₹]/g, "")
    .replace(/\s+/g, "")
    .replace(/lakhs?/gi, "l")
    .replace(/crores?/gi, "c")
    .toLowerCase();

  if (!cleaned) return null;

  if (/^\d+$/i.test(cleaned)) return Number(cleaned);

  const croreMatch = cleaned.match(/(\d+(?:\.\d+)?)c/);
  if (croreMatch) return Math.round(parseFloat(croreMatch[1]) * 10000000);

  const lakhMatch = cleaned.match(/(\d+(?:\.\d+)?)l/);
  if (lakhMatch) return Math.round(parseFloat(lakhMatch[1]) * 100000);

  const decimalMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|lacs|crore|cr)/);
  if (decimalMatch) {
    const value = parseFloat(decimalMatch[1]);
    const isCrore = /crore|cr/.test(cleaned);
    return Math.round(value * (isCrore ? 10000000 : 100000));
  }

  const numberOnly = cleaned.match(/^(\d+(?:\.\d+)?)$/);
  if (numberOnly) return Math.round(parseFloat(numberOnly[1]));

  return null;
}

function parseBudgetText(lower: string): { budgetMinInr?: number; budgetMaxInr?: number } | null {
  // Collect EVERY money mention positionally; the LATEST wins so spoken
  // self-corrections ("80 lakh... no, around 90 lakh") settle on the
  // correction. Single-mention inputs behave exactly as before.
  const candidates: Array<{ index: number; value: number; rangeEnd?: number }> = [];
  const moneyPatterns = [
    /(?:under|max|budget|within|around|upto|up to|less than|below)\s*(?:₹|rs\s*)?(\d+(?:[.,]\d+)?(?:\s*(?:lakh|lakhs|lac|lacs|crore|cr)))\b/i,
    /(?:₹|rs\s*)?(\d+(?:[.,]\d+)?(?:\s*(?:lakh|lakhs|lac|lacs|crore|cr)))\b/i,
    /(?:₹|rs\s*)?(\d+(?:[.,]\d+)?)\s*(?:l|c)\b/i,
    /(?:\b|\s)(\d{7,9}|\d{1,3}(?:,\d{3})+)(?:\s*(?:lakh|lakhs|lac|lacs|crore|cr))?\b/i,
  ];

  for (const pattern of moneyPatterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const raw = m[1].replace(/,/g, "");
      const value = normalizeBudgetValue(raw);
      if (value) candidates.push({ index: m.index, value });
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }

  const explicitRange = lower.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs|crore|cr)\s*(?:to|-)\s*(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs|crore|cr)/i);
  if (explicitRange && explicitRange.index != null) {
    const a = normalizeBudgetValue(explicitRange[1]);
    const b = normalizeBudgetValue(explicitRange[2]);
    if (a && b) {
      return { budgetMinInr: Math.min(a, b), budgetMaxInr: Math.max(a, b) };
    }
  }

  const bareNumber = lower.match(/\b(?:budget|around|max|under|within|upto|up to)\s*(\d{1,3}(?:\.\d+)?)\b/);
  if (bareNumber && bareNumber.index != null) {
    const parsed = parseFloat(bareNumber[1]);
    if (parsed && parsed > 0 && parsed <= 999) {
      candidates.push({ index: bareNumber.index, value: Math.round(parsed * 100000) });
    }
  }
  // Bare thousands ("budget 2000", "5000") read as raw rupees. Kept disjoint
  // from the lakh shorthand above (<=999) so existing behavior never shifts;
  // the response layer decides whether the value fits available inventory.
  const bareThousands = lower.match(/\b(?:budget|around|max|under|within|upto|up to)\s*(\d{4,5}(?:\.\d+)?)\b/);
  if (bareThousands && bareThousands.index != null) {
    const parsed = parseFloat(bareThousands[1]);
    if (parsed && parsed >= 1000 && parsed <= 99999) {
      candidates.push({ index: bareThousands.index, value: Math.round(parsed) });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((x, y) => x.index - y.index);
  return { budgetMaxInr: candidates[candidates.length - 1].value };
}

/** Captures that carry no location meaning ("around there") must never become
 *  a locality — they are what hesitant speech leaves behind. */
const LOCALITY_STOPWORDS = new Set([
  "there", "here", "it", "that", "this", "these", "those", "somewhere",
  "anywhere", "everywhere", "something", "anything", "around there",
  "near there", "over there",
]);

/**
 * Canonical city vocabulary shared by city extraction, locality handling and
 * intent detection. Keys are lower-case mentions (including common aliases and
 * a few tolerated typos); values are the canonical display spelling stored on
 * the lead and matched against property inventory.
 */
const CITY_CANONICAL: Record<string, string> = {
  gurgaon: "Gurgaon",
  gurugram: "Gurgaon",
  gurugao: "Gurgaon",
  gurgoan: "Gurgaon",
  gugran: "Gurgaon",
  noida: "Noida",
  "greater noida": "Greater Noida",
  "noida extension": "Noida",
  delhi: "Delhi",
  "new delhi": "Delhi",
  dilli: "Delhi",
  dehli: "Delhi",
  dilhi: "Delhi",
  ghaziabad: "Ghaziabad",
  gaziabad: "Ghaziabad",
  faridabad: "Faridabad",
  feridabad: "Faridabad",
  sonipat: "Sonipat",
  panipat: "Panipat",
  rewari: "Rewari",
  bhiwadi: "Bhiwadi",
  alwar: "Alwar",
  mumbai: "Mumbai",
  bombay: "Mumbai",
  "navi mumbai": "Mumbai",
  thane: "Thane",
  pune: "Pune",
  nagpur: "Nagpur",
  nashik: "Nashik",
  aurangabad: "Aurangabad",
  solapur: "Solapur",
  bangalore: "Bangalore",
  bengaluru: "Bangalore",
  bangaluru: "Bangalore",
  mysore: "Mysore",
  mysuru: "Mysore",
  mangalore: "Mangalore",
  mangaluru: "Mangalore",
  hyderabad: "Hyderabad",
  secunderabad: "Hyderabad",
  chennai: "Chennai",
  madras: "Chennai",
  coimbatore: "Coimbatore",
  madurai: "Madurai",
  kochi: "Kochi",
  cochin: "Kochi",
  trivandrum: "Thiruvananthapuram",
  thiruvananthapuram: "Thiruvananthapuram",
  kolkata: "Kolkata",
  calcutta: "Kolkata",
  howrah: "Howrah",
  jaipur: "Jaipur",
  jaiupr: "Jaipur",
  jipur: "Jaipur",
  jaypur: "Jaipur",
  jodhpur: "Jodhpur",
  udaipur: "Udaipur",
  kota: "Kota",
  ajmer: "Ajmer",
  bikaner: "Bikaner",
  lucknow: "Lucknow",
  kanpur: "Kanpur",
  prayagraj: "Prayagraj",
  allahabad: "Prayagraj",
  varanasi: "Varanasi",
  banaras: "Varanasi",
  kashi: "Varanasi",
  agra: "Agra",
  bareilly: "Bareilly",
  gorakhpur: "Gorakhpur",
  gwalior: "Gwalior",
  jabalpur: "Jabalpur",
  bhopal: "Bhopal",
  indore: "Indore",
  ratlam: "Ratlam",
  ahmedabad: "Ahmedabad",
  amdavad: "Ahmedabad",
  surat: "Surat",
  vadodara: "Vadodara",
  baroda: "Vadodara",
  rajkot: "Rajkot",
  patna: "Patna",
  ranchi: "Ranchi",
  jamshedpur: "Jamshedpur",
  dhanbad: "Dhanbad",
  chandigarh: "Chandigarh",
  ludhiana: "Ludhiana",
  amritsar: "Amritsar",
  jalandhar: "Jalandhar",
  dehradun: "Dehradun",
  haridwar: "Haridwar",
  rishikesh: "Rishikesh",
  haldwani: "Haldwani",
  visakhapatnam: "Visakhapatnam",
  vizag: "Visakhapatnam",
  vijayawada: "Vijayawada",
  guntur: "Guntur",
  warangal: "Warangal",
  goa: "Goa",
  panaji: "Goa",
  cuttack: "Cuttack",
  bhubaneswar: "Bhubaneswar",
  guwahati: "Guwahati",
  shillong: "Shillong",
  imphal: "Imphal",
  leh: "Leh",
  srinagar: "Srinagar",
  jammu: "Jammu",
  shimla: "Shimla",
  manali: "Manali",
  coorg: "Coorg",
  pondicherry: "Puducherry",
  puducherry: "Puducherry",
};

/** Word-boundary alternation used to recognise/strip city names in free text. */
const CITY_NAME_PATTERN = new RegExp(
  `\\b(?:${Object.values(CITY_CANONICAL)
    .concat(Object.keys(CITY_CANONICAL))
    .filter((name) => /^[a-z ]+$/i.test(name))
    .map((name) => name.replace(/ +/g, "\\s+"))
    .join("|")})\\b`,
  "i"
);

/** Best-effort city for a free-text mention (case/alias tolerant), or undefined. */
export function detectMentionedCity(text: string): string | undefined {
  return parseCityValue((text ?? "").toLowerCase());
}

/** Nouns that mark a phrase as a place ("golf course road", "sector 12").
 *  Deliberately narrow: everyday words ("property", "budget", "bhk") never
 *  qualify, so ordinary sentences can't produce phantom localities. */
const LOCALITY_INDICATORS =
  /\b(road|roads|sector|sectors|nagar|colony|enclave|marg|chowk|layout|extension|extn|phase|block|circle|crossing|park|heights|residency|plaza|square|expressway|highway|tower|vihar|puram|ganj|basti|mohalla)\b/;

function cleanLocality(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim().replace(/^[.,\s]+|[.,\s]+$/g, "");
  if (!cleaned || cleaned.length < 3 || cleaned.length > 48) return null;
  if (LOCALITY_STOPWORDS.has(cleaned.toLowerCase())) return null;
  if (CITY_NAME_PATTERN.test(cleaned.toLowerCase())) return null;
  // Money phrases are budgets, never places ("Budget around 80 lakh hai"
  // must not store locality "80 lakh hai").
  if (/₹|\d\s*(?:lakh|lakhs|lac|lacs|crore|cr)\b|\brs\.?\s*\d/i.test(cleaned)) return null;
  return cleaned;
}

/** Locality extraction: preposition phrases first ("near X"), then a
 *  second-chance scan for place-indicative phrases ("golf course road")
 *  that hesitant speech leaves without any preposition. Latest candidate
 *  wins, matching the self-correction rule used everywhere else. */
function parseLocalityValue(lower: string): string | null {
  const stop = String.raw`(?:for|under|budget|bhk|flat|apartment|house|villa|plot)`;
  const first = lower.match(new RegExp(`(?:in|near|around)\\s+([a-z0-9\\s.,-]+?)(?:\\s+(${stop})|$)`, "i"));
  if (first) {
    const cleaned = cleanLocality(first[1]);
    if (cleaned) return cleaned;
  }
  const fragments = lower.split(/[.,;!?]|(?:\.\.\.)|\b(?:umm+|uh+|ummm|actually|sorry|matlab|achha|you know|like|basically)\b/);
  let best: string | null = null;
  for (const fragment of fragments) {
    let candidate = fragment.trim().replace(/^[.,\s]+|[.,\s]+$/g, "");
    if (!candidate || candidate.length < 4 || candidate.length > 48) continue;
    if (!LOCALITY_INDICATORS.test(candidate)) continue;
    // A leading city belongs to the city slot, not the locality
    // ("gurgaon sector 12" → locality "sector 12").
    candidate = candidate.replace(new RegExp(`^(${CITY_NAME_PATTERN.source})[\\s,]+`, "i"), "").trim();
    if (!candidate || !LOCALITY_INDICATORS.test(candidate)) continue;
    best = candidate.replace(/\s+/g, " ");
  }
  return best;
}

function parseCityValue(lower: string): string | undefined {
  // LAST-wins self-correction ("Jaipur... sorry Gurgaon" → Gurgaon): every
  // word-boundary mention is positioned by its END, so the latest mention
  // wins. Longer mentions win ties, so "greater noida" resolves to Greater
  // Noida instead of the "noida" that sits inside it.
  let best: string | undefined;
  let bestEnd = -1;
  let bestLength = -1;
  for (const [key, value] of Object.entries(CITY_CANONICAL)) {
    const mention = new RegExp(`(?:^|[^a-z0-9])(${key.replace(/ +/g, "\\s+")})`, "gi");
    let at = -1;
    let m: RegExpExecArray | null;
    while ((m = mention.exec(lower)) !== null) {
      at = m.index + m[0].length;
      if (m[0].length === 0) mention.lastIndex += 1;
    }
    if (at < 0) continue;
    if (at > bestEnd || (at === bestEnd && key.length > bestLength)) {
      bestEnd = at;
      bestLength = key.length;
      best = value;
    }
  }
  if (best) return best;

  // Limited typo tolerance for well-known locations. Keep this deliberately
  // narrow: a fuzzy guess should never silently select an unrelated city.
  if (/\bnioda\b|\bnodia\b/.test(lower)) return "Noida";
  if (/\bdelli\b/.test(lower)) return "Delhi";
  if (/\bgurgao\b/.test(lower)) return "Gurgaon";

  return undefined;
}

/** Parses a bare budget answer given in reply to a budget question
 * ("80 lakh", "80L", "1.5 cr", "8000000"). Returns rupees or null.
 * Deliberately strict: only used when the previous AI turn asked for budget,
 * so stray numbers elsewhere are never misread as money. */
export function parseContextualBudget(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,₹]/g, "").toLowerCase();
  const m = cleaned.match(/^(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|l|crore|crores|cr|c)?$/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2] ?? "";
  if (/crore|cr|c/.test(unit) && unit) return Math.round(value * 10000000);
  if (/lakh|lac|l/.test(unit) && unit) return Math.round(value * 100000);
  // Bare number with no unit: plausible INR only in a sane home-budget band.
  if (!unit && value >= 100000 && value <= 1000000000) return Math.round(value);
  // Bare small number ("80", "1.5") after a budget prompt almost always means lakh.
  if (!unit && value > 0 && value <= 999) return Math.round(value * 100000);
  // Bare thousands ("2000", "5000") after a budget prompt read as raw rupees
  // (e.g. a monthly-rent figure). Disjoint from the lakh band above and the
  // large-value band below, so no existing mapping shifts.
  if (!unit && value >= 1000 && value <= 99999) return Math.round(value);
  return null;
}

function parsePropertyType(lower: string): ExtractedRequirements["propertyType"] | undefined {
  if (/villa/.test(lower) || /independent house/.test(lower)) return "VILLA";
  if (/plot/.test(lower)) return "PLOT";
  if (/apartment|flat|studio/.test(lower)) return "APARTMENT";
  if (/house/.test(lower)) return "INDEPENDENT_HOUSE";
  return undefined;
}

function parsePurpose(lower: string): ExtractedRequirements["purpose"] | undefined {
  // LAST-wins self-correction ("rent... no, I want to buy" → BUY): position
  // each intent group and take the latest. Ties keep the historic priority.
  const lastIndexOf = (patterns: RegExp[]): number => {
    let best = -1;
    for (const re of patterns) {
      const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
      const global = new RegExp(re.source, flags);
      let m: RegExpExecArray | null;
      while ((m = global.exec(lower)) !== null) {
        if (m.index > best) best = m.index;
        if (m[0].length === 0) global.lastIndex += 1;
      }
    }
    return best;
  };
  const rentAt = lastIndexOf([/\brent\b/, /\blease\b/, /\bkiraye\b/, /\bkiraaye\b/, /\bkiraya\b/]);
  const investAt = lastIndexOf([/\binvest\b/, /\binvestment\b/, /\binvestor\b/]);
  const buyAt = lastIndexOf([
    /\bbuy\b/,
    /\bbuying\b/,
    /\bbuy\b(?:ing)?\s+(?:a\s+)?(?:home|house|flat|apartment|property|villa)/,
    /\bkharidna\b/,
    /\bkharid\b/,
    /\bfor my family\b/,
    /\bfor our family\b/,
    /\bfor myself\b/,
    /\bour family\b/,
    /\bmy family\b/,
    // Self-use / end-use buyers are buyers even without the word "buy"
    // ("3 BHK for my family", "self-use ke liye", "own use").
    /\bself[- ]?use\b/,
    /\bself use\b/,
    /\bown use\b/,
    /\bend use\b/,
    /\bresidential use\b/,
    /\bfor our own\b/,
  ]);
  if (rentAt < 0 && investAt < 0 && buyAt < 0) return undefined;
  if (rentAt >= investAt && rentAt >= buyAt) return "RENT";
  if (investAt >= buyAt) return "INVEST";
  return "BUY";
}

function parseTimeline(lower: string): string | undefined {
  if (/ready to move|ready-to-move|move in|move-in|immediate/.test(lower)) return "ready_to_move";
  if (/within\s+\d+\s*(day|week|month)s?/.test(lower)) return lower.match(/(within\s+\d+\s*(?:day|week|month)s?)/i)?.[0];
  if (/\bwithin (?:a|one) month\b|\bin (?:a|one) month\b|\bwithin a month\b/.test(lower)) return "within 1 month";
  if (/\bthis month\b/.test(lower)) return "this month";
  if (/\bnext month\b/.test(lower)) return "next month";
  if (/\b(?:this|next) quarter\b/.test(lower)) return "within 3 months";
  const months = lower.match(/(\d+)\s*(?:month|months|mahine|mahina)\b/);
  if (months) return `within ${months[1]} months`;
  const weeks = lower.match(/(\d+)\s*(?:week|weeks|hafte)\b/);
  if (weeks) return `within ${weeks[1]} weeks`;
  if (/\b3\s*-\s*6\s*months?\b|\bnext few months\b/.test(lower)) return "within 6 months";
  if (/asap|urgent|immediate|jaldi|turant/.test(lower)) return "immediate";
  if (/\bjust (looking|browsing|exploring|researching)\b/.test(lower)) return "exploring";
  return undefined;
}

/** Coerce an LLM/rule extraction field into a trimmed, length-capped string. */
function toText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > max) return undefined;
  return cleaned;
}

function toInt(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const rounded = Math.round(n);
  return rounded >= min && rounded <= max ? rounded : undefined;
}

function toPropertyType(value: unknown): ExtractedRequirements["propertyType"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (PROPERTY_TYPES.has(normalized)) return normalized as ExtractedRequirements["propertyType"];
  return undefined;
}

/** Budgets must survive the trip through an LLM without corrupting the lead.
 *  - strings go through the normal lakh/crore parser,
 *  - tiny integers are read as lakh shorthand ("90" → ₹90,00,000),
 *  - anything non-positive, absurdly large, or below ₹10,000 is dropped. */
function toBudget(value: unknown): number | undefined {
  let n: number | undefined;
  if (typeof value === "number") {
    if (Number.isFinite(value) && value > 0) {
      n = value <= 999 && Number.isInteger(value) ? value * 100000 : value;
    }
  } else if (typeof value === "string") {
    const cleaned = value.trim();
    if (/^\d+(\.\d+)?$/.test(cleaned)) {
      const bare = parseFloat(cleaned);
      n = bare <= 999 && Number.isInteger(bare) ? bare * 100000 : bare;
    } else {
      const parsed = normalizeBudgetValue(cleaned);
      if (parsed != null && parsed > 0) n = parsed;
    }
  }
  if (n == null) return undefined;
  const rounded = Math.round(n);
  if (rounded < 1000 || rounded > 5_000_000_000) return undefined;
  return rounded;
}

function toPurpose(value: unknown): ExtractedRequirements["purpose"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (PURPOSES.has(normalized)) return normalized as ExtractedRequirements["purpose"];
  return undefined;
}

function toBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function toName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 80) return undefined;
  return cleaned;
}

function toPhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return undefined;
}

function toEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 120) return undefined;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleaned)) return cleaned;
  return undefined;
}

/**
 * Validates/coerces a requirement payload before it is merged onto a lead.
 * The rule-based extractor already produces clean values; this matters for
 * LLM extraction, whose free-form JSON must never be able to write a string
 * into `bhk`, a negative budget, or an unrecognised enum into a lead row.
 * Unknown keys are dropped; absent keys stay absent (never written as null).
 */
export function sanitizeExtractedRequirements(raw: unknown): ExtractedRequirements {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: ExtractedRequirements = {};

  // City: use detectMentionedCity for known cities, otherwise keep plausible names
  const cityRaw = coerceShortString(src.preferredCity, 60);
  if (cityRaw) {
    const known = detectMentionedCity(cityRaw);
    if (known) {
      out.preferredCity = known;
    } else if (!/₹|\d/.test(cityRaw) && !LOCALITY_INDICATORS.test(cityRaw) && !LOCALITY_STOPWORDS.has(cityRaw.toLowerCase())) {
      out.preferredCity = cityRaw;
    }
  }

  // Locality: clean through the locality parser
  const localityRaw = coerceShortString(src.preferredLocality, 60);
  if (localityRaw) {
    const cleaned = cleanLocality(localityRaw);
    if (cleaned) out.preferredLocality = cleaned;
  }

  // Property type: normalize and validate against known types
  const propertyTypeRaw = typeof src.propertyType === "string" ? src.propertyType.trim().toLowerCase() : "";
  if (propertyTypeRaw) {
    const pt = parsePropertyType(propertyTypeRaw);
    if (pt) out.propertyType = pt;
  }

  // BHK: coerce to integer in valid range
  const bhk = coerceIntInRange(src.bhk, 1, 12);
  if (bhk != null) out.bhk = bhk;

  // Budget: coerce using existing budget parser
  const budgetMin = coerceBudgetInr(src.budgetMinInr);
  const budgetMax = coerceBudgetInr(src.budgetMaxInr);
  if (budgetMin != null && budgetMax != null) {
    out.budgetMinInr = Math.min(budgetMin, budgetMax);
    out.budgetMaxInr = Math.max(budgetMin, budgetMax);
  } else if (budgetMin != null) {
    out.budgetMinInr = budgetMin;
  } else if (budgetMax != null) {
    out.budgetMaxInr = budgetMax;
  }

  // Purpose: normalize and validate
  const purposeRaw = typeof src.purpose === "string" ? src.purpose.trim().toLowerCase() : "";
  if (purposeRaw) {
    const p = parsePurpose(purposeRaw);
    if (p) out.purpose = p;
  }

  // Timeline: coerce short string
  const timeline = coerceShortString(src.timeline, 60);
  if (timeline) out.timeline = timeline;

  // Boolean fields: coerce from various truthy/falsy representations
  const loanRequired = coerceBool(src.loanRequired);
  if (loanRequired != null) out.loanRequired = loanRequired;

  const siteVisitInterest = coerceBool(src.siteVisitInterest);
  if (siteVisitInterest != null) out.siteVisitInterest = siteVisitInterest;

  // Name: coerce short string, strip digits/symbols
  const nameRaw = coerceShortString(src.name, 80);
  if (nameRaw) {
    const cleaned = nameRaw.replace(/[0-9?$%@#*_\-\\/<>()[\]{}":=;!,?]/g, "").replace(/\s+/g, " ").trim();
    if (cleaned && cleaned.split(" ").length <= 5 && !/ the | and | for | looking | budget | bhk /i.test(` ${cleaned} `)) {
      out.name = cleaned;
    }
  }

  // Phone: extract digits, validate length
  const phoneRaw = typeof src.phone === "string" ? src.phone.replace(/\D/g, "") : "";
  if (phoneRaw.length === 10) {
    out.phone = phoneRaw;
  } else if (phoneRaw.length === 12 && phoneRaw.startsWith("91")) {
    out.phone = phoneRaw.slice(2);
  } else if (phoneRaw.length === 11 && phoneRaw.startsWith("0")) {
    out.phone = phoneRaw.slice(1);
  }

  // Email: basic validation
  const emailRaw = coerceShortString(src.email, 120);
  if (emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(emailRaw)) {
    out.email = emailRaw.toLowerCase();
  }

  return out;
}

// Helper to coerce boolean from various representations
function coerceBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "required"].includes(v)) return true;
    if (["false", "no", "n", "0", "not required"].includes(v)) return false;
  }
  return undefined;
}

export async function extractRequirements(message: string): Promise<ExtractedRequirements> {
  if (!aiIsConfigured()) return sanitizeExtractedRequirements(ruleBasedExtract(message));

  try {
    const { text } = await callAI({
      system: EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: message }],
      maxTokens: 300,
    });
    const cleaned = text.replace(/```json|```/g, "").trim();
    return sanitizeExtractedRequirements(JSON.parse(cleaned || "{}"));
  } catch {
    // Never let extraction failures break the conversation — fall back.
    return sanitizeExtractedRequirements(ruleBasedExtract(message));
  }
}
