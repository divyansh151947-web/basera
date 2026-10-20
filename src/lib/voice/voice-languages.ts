import "server-only";

/**
 * INDIA-FIRST VOICE LANGUAGE CAPABILITY MAP.
 *
 * Routes language → verified speech provider WITHOUT hardcoding every
 * language to Kokoro. A language is routable ONLY when a model with
 * verified voice coverage exists; everything else fails explicitly at the
 * adapter (never silent remapping — Hindi output for a Marathi request
 * would be a lie, so Marathi is rejected with its best-candidate note).
 *
 * STATUS VOCABULARY (load-bearing — do not conflate):
 * - "supported": a configured provider has real voices for this language.
 * - "experimental": routable only as an explicitly-marked experiment, or
 *   not routable yet but under investigation (see notes).
 * - "unsupported": no verified provider — adapter calls fail clearly.
 * `tested`/`goodQuality` are independent: NOTHING here claims listened
 * quality unless a human listening evaluation actually happened
 * (goodQuality stays null otherwise).
 *
 * VERIFIED MODEL FACTS (checked 2026-09-21; sources in comments):
 * - Kokoro-82M (hexgrad): Apache-2.0 weights+code, commercial use explicitly
 *   welcomed. 8 languages / 54 voices (VOICES.md): en, es, fr, hi, it, ja,
 *   pt-BR, zh. Hindi voices (hf_alpha/hf_beta/hm_omega/hm_psi) carry the
 *   author's own overall grade C (target quality B). Requires espeak-ng +
 *   misaki phonemizers. https://huggingface.co/hexgrad/Kokoro-82M
 * - Coqui XTTS v2: CPML 1.0.0, NON-COMMERCIAL ONLY, and Coqui shut down so
 *   no commercial license can be obtained. REJECTED for Basera SaaS.
 * - Meta MMS-TTS: CC-BY-NC 4.0. REJECTED for Basera SaaS (covers Indian
 *   languages but the NC clause forbids commercial use).
 * - AI4Bharat Indic Parler-TTS Mini: Apache-2.0, 21 languages including all
 *   14 Basera priorities (as, bn, gu, hi, kn, ml, mr, or, pa [unofficial],
 *   ta, te, ur + en). Transformers-based, ~880M params (GPU recommended for
 *   realtime; CPU possible but slow). Quality NOT evaluated by us — best
 *   FUTURE candidate for non-Kokoro Indian languages, not a claim.
 *   https://huggingface.co/ai4bharat/indic-parler-tts
 * - Sarvam Bulbul v2/v3: proprietary pay-per-use API (₹15–30/10K chars),
 *   11 Indian languages. NOT self-hosted, NOT free — paid fallback only.
 * - Piper (OHF-Voice/piper1-gpl, active): GPL-3.0-or-later (was MIT before
 *   archival). Copyleft risk for closed-source embedding — lawyer review
 *   required before any commercial use. Fast CPU inference otherwise.
 */

export type IndianVoiceStatus = "supported" | "experimental" | "unsupported";

/** Verified speech route for a language today (null = none verified). */
export type VerifiedVoiceRoute = "kokoro" | "openai" | null;

export interface LanguageCapability {
  code: string;
  label: string;
  status: IndianVoiceStatus;
  /** True only after real audio was generated for this language. */
  tested: boolean;
  /** True only after a human listening evaluation. Null = unevaluated. */
  goodQuality: boolean | null;
  route: VerifiedVoiceRoute;
  /** Voice ID on the routed provider (null when unrouted). */
  voice: string | null;
  model: string | null;
  license: string | null;
  /** Research-backed future route (unverified — never auto-selected). */
  bestCandidate: string | null;
  notes: string;
}

export const INDIAN_VOICE_CAPABILITIES: Record<string, LanguageCapability> = {
  en: {
    code: "en", label: "English", status: "supported", tested: true, goodQuality: null,
    route: "kokoro", voice: "af_sarah", model: "Kokoro-82M", license: "Apache-2.0",
    bestCandidate: null,
    notes: "Kokoro American-English voices. Audio generation verified locally (24 kHz speech, healthy levels). Listened quality unevaluated.",
  },
  hi: {
    code: "hi", label: "Hindi", status: "supported", tested: true, goodQuality: null,
    route: "kokoro", voice: "hf_alpha", model: "Kokoro-82M", license: "Apache-2.0",
    bestCandidate: null,
    notes: "Kokoro Hindi voices hf_alpha/hf_beta/hm_omega/hm_psi. Audio generation verified locally. Author overall grade C (target B); listened quality unevaluated. Requires espeak-ng hi + misaki.",
  },
  hinglish: {
    code: "hinglish", label: "Hinglish", status: "experimental", tested: true, goodQuality: null,
    route: "kokoro", voice: "hf_alpha", model: "Kokoro-82M", license: "Apache-2.0",
    bestCandidate: null,
    notes: "No native Hinglish voice exists; romanized text generated audio via the Hindi pipeline (verified generation only). Code-mixed listened quality unevaluated — EXPERIMENTAL.",
  },
  mr: {
    code: "mr", label: "Marathi", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Marathi support, quality unverified)",
    notes: "Kokoro has no Marathi voices. MMS covers Marathi but is CC-BY-NC (commercially unusable).",
  },
  bn: {
    code: "bn", label: "Bengali", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Bengali support, quality unverified)",
    notes: "Kokoro has no Bengali voices. MMS covers Bengali but is CC-BY-NC (commercially unusable).",
  },
  gu: {
    code: "gu", label: "Gujarati", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Gujarati support, quality unverified)",
    notes: "Kokoro has no Gujarati voices.",
  },
  pa: {
    code: "pa", label: "Punjabi", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, unofficial Punjabi support, quality unverified)",
    notes: "Kokoro has no Punjabi voices. Parler lists Punjabi as unofficial support only.",
  },
  ta: {
    code: "ta", label: "Tamil", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Tamil support, quality unverified)",
    notes: "Kokoro has no Tamil voices.",
  },
  te: {
    code: "te", label: "Telugu", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Telugu support, quality unverified)",
    notes: "Kokoro has no Telugu voices.",
  },
  kn: {
    code: "kn", label: "Kannada", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Kannada support, quality unverified)",
    notes: "Kokoro has no Kannada voices.",
  },
  ml: {
    code: "ml", label: "Malayalam", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Malayalam support, quality unverified)",
    notes: "Kokoro has no Malayalam voices.",
  },
  or: {
    code: "or", label: "Odia", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Odia support, quality unverified)",
    notes: "Kokoro has no Odia voices. MMS covers Odia (ory) but is CC-BY-NC (commercially unusable).",
  },
  as: {
    code: "as", label: "Assamese", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Assamese support, quality unverified)",
    notes: "Kokoro has no Assamese voices.",
  },
  ur: {
    code: "ur", label: "Urdu", status: "unsupported", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: "ai4bharat/indic-parler-tts (Apache-2.0, official Urdu support, quality unverified)",
    notes: "Kokoro has no Urdu voices.",
  },
  rajasthani: {
    code: "rajasthani", label: "Rajasthani", status: "experimental", tested: false, goodQuality: null,
    route: null, voice: null, model: null, license: null,
    bestCandidate: null,
    notes: "EXPERIMENTAL ONLY: no verified model supports Rajasthani TTS. Must fail explicitly — Hindi output for Rajasthani input would be misrepresentation.",
  },
};

/** Priority order for the India-first product story (display order only). */
export const INDIAN_LANGUAGE_PRIORITY: string[] = [
  "hi", "mr", "bn", "gu", "pa", "ta", "te", "kn", "ml", "or", "as", "ur", "en", "hinglish",
];

export function getLanguageCapability(code: string): LanguageCapability | null {
  return INDIAN_VOICE_CAPABILITIES[code] ?? null;
}

/** True only for languages with a verified route today (Kokoro en/hi,
 *  experimental Hinglish). Everything else must fail explicitly. */
export function isRoutableIndianLanguage(code: string): boolean {
  const cap = getLanguageCapability(code);
  return cap != null && cap.route === "kokoro" && (cap.status === "supported" || cap.status === "experimental");
}
