import "server-only";
import type {
  VoiceLanguage,
  VoiceProvider,
  VoiceSynthesizeInput,
  VoiceSynthesizeResult,
  VoiceTurnInput,
  VoiceTurnResult,
} from "./voice-provider";
import { getLanguageCapability } from "./voice-languages";

/**
 * KOKORO VOICE PROVIDER (opt-in self-hosted TTS).
 *
 * Transport: OpenAI-compatible speech endpoint on a SELF-HOSTED Kokoro
 * service (e.g. Kokoro-FastAPI): POST {KOKORO_BASE_URL}/v1/audio/speech
 * with {model, voice, input, response_format}. Basera calls the service the
 * operator configures — never a hardcoded host, never a hosted third party
 * by default. KOKORO_API_KEY is optional (self-hosted services commonly
 * need no key) and, when set, travels ONLY in the Authorization header.
 *
 * SCOPE (honest): Kokoro is a TEXT-TO-SPEECH model — it does not transcribe.
 * prepareTurn therefore accepts typed transcripts (the standard pipeline
 * still does extraction/scoring/reply) and REJECTS audio input with a clear
 * error instead of secretly billing another vendor's STT. Use
 * VOICE_PROVIDER=openai for full voice turns.
 *
 * FAIL-SAFE: unconfigured/unreachable Kokoro throws; NOTHING falls back to
 * OpenAI (that would create surprise API costs). Unknown/unsupported
 * languages and voice IDs fail explicitly — Hindi is never silently
 * substituted for another language (e.g. Rajasthani, Marathi).
 *
 * PRIVACY/COST: raw audio is never sent here (typed input only); server
 * responses are bytes, never stored or logged; per-turn latency/size land
 * in providerMetadata (telemetry on the result object, not log spam).
 */

export const KOKORO_VOICE_PROVIDER_ID = "kokoro";

/** Default voice per supported language (documented Kokoro-82M voice IDs).
 *  Hinglish is code-mixed speech: the Hindi voice reads it best-effort —
 *  no production-quality claim is made without live testing. */
const LANGUAGE_DEFAULT_VOICES: Record<string, string> = {
  en: "af_sarah",
  hi: "hf_alpha",
  hinglish: "hf_alpha",
  es: "ef_dora",
  fr: "ff_siwis",
  it: "if_sara",
  ja: "jf_alpha",
  zh: "zf_xiaobei",
  pt: "pf_dora",
};

/** Known Kokoro-82M voice IDs. KOKORO_VOICE overrides must be in this set —
 *  an unknown ID fails instead of reaching the server as a typo. */
const KNOWN_VOICE_IDS = new Set([
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
  "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael",
  "am_onyx", "am_puck",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
  "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  "ef_dora", "em_alex", "em_santa",
  "ff_siwis",
  "hf_alpha", "hf_beta", "hm_omega", "hm_psi",
  "if_sara", "im_nicola",
  "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo",
  "pf_dora", "pm_alex", "pm_santa",
  "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi",
  "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang",
]);

export function kokoroIsConfigured(): boolean {
  return Boolean(process.env.KOKORO_BASE_URL?.trim());
}

function baseUrl(): string {
  const raw = process.env.KOKORO_BASE_URL?.trim();
  if (!raw) throw new Error('Voice provider "kokoro" is not configured. Set KOKORO_BASE_URL to your self-hosted Kokoro service.');
  return raw.replace(/\/+$/, "");
}

function kokoroModel(): string {
  return process.env.KOKORO_MODEL?.trim() || "kokoro";
}

function turnTimeoutMs(): number {
  const raw = Number(process.env.VOICE_TURN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 5_000 && raw <= 120_000 ? raw : 60_000;
}

/** Resolve the synthesis voice: explicit override (validated) else the
 *  language default. Routing for Indian languages comes from the shared
 *  capability map (voice-languages.ts) — never hardcoded per-language here.
 *  Unsupported languages fail explicitly (Hindi is NOT Rajasthani, and the
 *  error says so); international mappings below are pre-existing behavior,
 *  preserved unchanged and out of scope for India-first work. */
export function resolveKokoroVoice(language: VoiceLanguage, override?: string | null): string {
  if (override != null && override !== "") {
    if (!KNOWN_VOICE_IDS.has(override)) {
      throw new Error(`Voice voice "${override}" is not a known Kokoro voice. Check KOKORO_VOICE.`);
    }
    return override;
  }
  const capability = getLanguageCapability(language);
  if (capability && capability.route === "kokoro" && capability.voice) {
    return capability.voice;
  }
  if (capability && capability.status === "unsupported") {
    throw new Error(
      `Voice language "${language}" is not supported by the Kokoro provider.` +
      (capability.bestCandidate ? ` Best verified alternative: ${capability.bestCandidate}.` : "")
    );
  }
  if (capability && capability.status === "experimental" && capability.route == null) {
    throw new Error(
      `Voice language "${language}" is experimental and has no verified Kokoro voice. ${capability.notes}`
    );
  }
  const mapped = LANGUAGE_DEFAULT_VOICES[language];
  if (!mapped) {
    throw new Error(
      `Voice language "${language}" is not supported by the Kokoro provider. ` +
      `Supported: ${Object.keys(LANGUAGE_DEFAULT_VOICES).join(", ")}.`
    );
  }
  return mapped;
}

function toError(status: number | null): Error {
  if (status === 401 || status === 403) return new Error("Voice synthesis is not authorized. Check the Kokoro server configuration.");
  if (status === 429) return new Error("Voice synthesis is rate-limited right now. Please try again shortly.");
  if (status === 408 || status === null) return new Error("Voice synthesis timed out. Please try again.");
  return new Error("Voice synthesis failed. Please try again.");
}

export class KokoroVoiceProvider implements VoiceProvider {
  readonly id = KOKORO_VOICE_PROVIDER_ID;
  readonly mode = "live" as const;
  readonly label = "Kokoro TTS (self-hosted, server relay)";

  /** Typed-transcript turns only. Audio is rejected: Kokoro is a TTS model
   *  and this adapter will not secretly route audio to another vendor. */
  async prepareTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
    baseUrl();
    if (input.audioBase64) {
      throw new Error(
        "Kokoro provides speech output only. Send typed transcript text in kokoro mode, or run VOICE_PROVIDER=openai for full voice turns."
      );
    }
    const transcriptText = input.transcriptText.trim();
    if (!transcriptText) throw new Error("Empty voice transcript.");
    if (transcriptText.length > 2000) throw new Error("Voice transcript too long.");
    // Validate the language up front so an unsupported language fails
    // before any pipeline work (same rule as synthesis).
    resolveKokoroVoice(input.language, process.env.KOKORO_VOICE);
    return {
      transcriptText,
      language: input.language,
      mock: false,
      processingNote: "Kokoro provider: typed transcript (Kokoro is speech-output only; no audio input processed).",
      providerMetadata: { provider: KOKORO_VOICE_PROVIDER_ID, audioProcessedBy: "none (typed input)" },
    };
  }

  /** Synthesize the Basera reply via the configured self-hosted service. */
  async synthesizeReply(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult> {
    const base = baseUrl();
    const text = input.replyText.trim().slice(0, 2000);
    if (!text) throw new Error("Nothing to synthesize.");
    const voice = resolveKokoroVoice(input.language, process.env.KOKORO_VOICE);
    const apiKey = process.env.KOKORO_API_KEY?.trim() || null;

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), turnTimeoutMs());
    let res: Response;
    try {
      res = await fetch(`${base}/v1/audio/speech`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model: kokoroModel(), voice, input: text, response_format: "mp3" }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw toError(null);
      throw new Error("Voice synthesis failed. The Kokoro server could not be reached.");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw toError(res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error("Voice synthesis failed. Please try again.");
    return {
      audioBase64: buffer.toString("base64"),
      audioMimeType: "audio/mpeg",
      mock: false,
      processingNote: "Kokoro provider: reply synthesized by the configured self-hosted service; raw audio is not stored.",
      providerMetadata: {
        provider: KOKORO_VOICE_PROVIDER_ID,
        voice,
        model: kokoroModel(),
        responseBytes: buffer.length,
        requestMs: Date.now() - startedAt,
      },
    };
  }
}
