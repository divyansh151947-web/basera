import type { VoiceLanguage } from "@/lib/voice/voice-provider";

/**
 * VOICE LANGUAGE AUTO-DETECTION + REPLY LOCALIZATION (additive layer).
 *
 * The Basera conversation agent reasons in English templates; this module
 * sits AROUND it in the voice turn only:
 *  1. detectVoiceLanguage() classifies each turn transcript as en/hi/hinglish
 *     from the transcript itself (Devanagari script + roman-Hindi lexicon vs
 *     English lexicon). Low-confidence turns retain the previous language so
 *     one ambiguous word ("Jaipur.", "80 lakh.") never flips the session.
 *  2. localizeVoicePrompt() swaps a SMALL closed set of known agent prompt
 *     strings (missing-requirement questions) for Hindi/Hinglish equivalents
 *     by EXACT match. Everything else passes through in English — the layer
 *     never paraphrases, never invents, and never touches AI behavior.
 *
 * Deterministic, dependency-free, fully unit-tested.
 */

export type DetectedVoiceLanguage = "en" | "hi" | "hinglish";

export interface VoiceLanguageDetection {
  language: DetectedVoiceLanguage;
  confident: boolean;
}

const DEVANAGARI_RE = /[ऀ-ॿ]/;

/** Roman-script Hindi tokens. Strong = almost never English; weak = Hindi-leaning. */
const HINDI_STRONG = new Set([
  "dikhao", "dikha", "dikhaiye", "dikhayie", "dekhao", "dekho",
  "mujhe", "mujhko", "hamein", "hamen", "tumhe", "tumhein", "aapko",
  "chahiye", "chahie", "kaha", "kahan", "kahaan", "kidhar",
  "bahar", "andar", "ander", "upar", "neeche", "neche",
  "kitna", "kitne", "kitni", "kya", "kaise", "kaun", "kisko",
  "kholo", "kholiye", "khol", "batao", "bataiye", "sunao",
  "wala", "wali", "wale", "raha", "rahi", "rahe", "hoon", "haan", "hain",
  "achha", "achcha", "accha", "bilkul", "zaroor", "kripya", "meherbani",
  "samjhao", "bhai", "dost", "namaste", "dhanyavad", "shukriya",
  "lechal", "chaliye", "jaiye", "karo", "kijiye", "kariye", "kijiyega",
  "bhejo", "nikalo", "lao", "dekhta", "dekhti", "lagta", "padega",
  "hoga", "hogi", "honge", "tha", "thi", "hoti", "hota",
]);

const HINDI_WEAK = new Set([
  "mein", "main", "mere", "meri", "mera", "apna", "apni", "apne",
  "hamara", "hamari", "tumhara", "tumhari", "aap", "tum", "hum", "humari",
  "ke", "ki", "ka", "ko", "se", "par", "liye", "sath", "saath", "aur",
  "yeh", "ye", "woh", "vo", "jo", "kuch", "bhi", "nahi", "nahin", "hai",
  "ab", "phir", "bas", "mat", "na", "toh", "kafi", "bahut", "bohot",
  "thoda", "zyada", "kam", "accha", "theek", "sahi", "galat", "naya", "purana",
]);

const ENGLISH_TOKENS = new Set([
  "show", "please", "open", "sure", "what", "which", "how", "much", "many",
  "need", "want", "looking", "bedroom", "bathroom", "kitchen", "parking",
  "swimming", "garden", "terrace", "balcony", "rooftop", "building", "tower",
  "city", "budget", "property", "properties", "house", "flat", "apartment",
  "villa", "home", "buy", "rent", "hello", "hi", "hey", "thanks", "thank",
  "yes", "no", "okay", "ok", "please", "tell", "about", "your", "yours",
  "recovery", "leads", "lead", "revenue", "risk", "follow", "appointment",
  "appointments", "settings", "dashboard", "conversations", "analytics",
  "voice", "talk", "agent", "help", "can", "the", "a", "an", "to", "my",
  "me", "i", "is", "are", "do", "does", "in", "under", "for", "of", "and",
]);

function tokenize(text: string): string[] {
  // Keep Latin + Devanagari letters and digits; drop punctuation/emoji.
  // (Explicit ranges: \p{} property escapes need a newer TS lib target.)
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Classify a turn transcript. Returns the previous language with
 * confident:false when the text carries no usable signal, so callers can
 * retain session language instead of flipping on noise.
 */
export function detectVoiceLanguage(
  text: string,
  previous: DetectedVoiceLanguage = "en"
): VoiceLanguageDetection {
  const raw = (text ?? "").trim();
  if (!raw) return { language: previous, confident: false };
  if (DEVANAGARI_RE.test(raw)) return { language: "hi", confident: true };

  const tokens = tokenize(raw);
  if (tokens.length === 0) return { language: previous, confident: false };

  let hindiScore = 0;
  let englishScore = 0;
  for (const t of tokens) {
    if (HINDI_STRONG.has(t)) hindiScore += 2;
    else if (HINDI_WEAK.has(t)) hindiScore += 1;
    if (ENGLISH_TOKENS.has(t)) englishScore += 1;
  }

  if (hindiScore === 0 && englishScore === 0) {
    return { language: previous, confident: false };
  }
  if (hindiScore === 0) return { language: "en", confident: englishScore > 0 };
  if (englishScore === 0) return { language: "hi", confident: true };
  // Both present: Hindi-dominant short commands stay Hindi ("pool dikhao"
  // is Hindi-led), balanced mixes are Hinglish.
  if (hindiScore >= 3 && englishScore <= 1) return { language: "hi", confident: true };
  return { language: "hinglish", confident: hindiScore + englishScore >= 3 };
}

/** Narrow a stored session language to the voice reply language set. */
export function toReplyLanguage(value: unknown): DetectedVoiceLanguage {
  if (value === "hi" || value === "hinglish" || value === "en") return value;
  const v = detectVoiceLanguage(typeof value === "string" ? value : "");
  return v.language;
}

/**
 * Exact-match localization for the agent's known missing-requirement
 * prompts. These four strings are produced verbatim by
 * buildMissingRequirementPrompt(); anything else passes through untouched.
 *
 * Hindi variants are Devanagari (matching the agent's own hi prompts), so a
 * swapped-in reply is actually spoken as Hindi by TTS — Roman-script "Hindi"
 * here would be pronounced as English.
 */
const PROMPT_LOCALIZATIONS: Record<string, { hi: string; hinglish: string }> = {
  "Sure! Which city or area are you looking in?": {
    hi: "बिल्कुल! आप किस शहर या एरिया में देख रहे हैं?",
    hinglish: "Sure! Aap kaunse city ya area mein dekh rahe ho?",
  },
  "What kind of property are you looking for — for example, 2 BHK or 3 BHK?": {
    hi: "आपको कैसी प्रॉपर्टी चाहिए — जैसे 2 BHK या 3 BHK?",
    hinglish: "Aapko kaisi property chahiye — for example, 2 BHK ya 3 BHK?",
  },
  "What is your approximate budget range?": {
    hi: "आपका लगभग बजट क्या है?",
    hinglish: "Aapka approximate budget kya hai?",
  },
  "I can help narrow that down — what matters most to you right now: city, BHK, or budget?": {
    hi: "मैं आपकी मदद कर सकता हूँ — अभी आपके लिए क्या ज़रूरी है: शहर, BHK, या बजट?",
    hinglish: "Main help kar sakta hoon — abhi aapke liye kya important hai: city, BHK, ya budget?",
  },
};

export function localizeVoicePrompt(reply: string, language: DetectedVoiceLanguage): string {
  if (language === "en") return reply;
  const entry = PROMPT_LOCALIZATIONS[reply];
  if (!entry) return reply;
  return language === "hi" ? entry.hi : entry.hinglish;
}

/** Assert a session language value is a valid voice language tag. */
export function isVoiceReplyLanguage(value: unknown): value is VoiceLanguage {
  return value === "en" || value === "hi" || value === "hinglish";
}
