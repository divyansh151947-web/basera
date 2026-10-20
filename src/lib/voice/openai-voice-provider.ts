import "server-only";
import type {
  VoiceLanguage,
  VoiceProvider,
  VoiceSynthesizeInput,
  VoiceSynthesizeResult,
  VoiceTurnInput,
  VoiceTurnResult,
} from "./voice-provider";

/**
 * OPENAI VOICE PROVIDER (Voice AI Phase 2, live mode).
 *
 * Server-relayed speech turns over the SAME Basera turn pipeline:
 *   browser mic audio → Whisper transcription (server-side)
 *     → processInboundMessage (unchanged Basera brain)
 *     → gpt-4o-mini-tts synthesis (server-side)
 *     → audio back to the browser for playback.
 *
 * SECURITY: OPENAI_API_KEY lives server-side only and travels exclusively
 * in the Authorization header to api.openai.com. It is never placed in
 * bodies, URLs, logs, responses, or client bundles. Errors surfaced to
 * callers are status-shaped and generic — provider bodies are never
 * forwarded (they could theoretically echo request data).
 *
 * COST CONTROL: audio input is byte-capped before upload; TTS input is the
 * already-concise AI reply; every turn still counts against the existing
 * per-session/per-IP voice rate limits. No streaming hold-open: each turn
 * is one bounded STT call plus one bounded TTS call.
 *
 * HONEST LIMITS (Phase 2): turns are server-relayed, not streamed — there
 * is no provider-native barge-in/VAD turn-taking on this transport (the
 * browser does client-side playback interruption only). Sub-second
 * streaming realtime (WebRTC) is the documented Phase 3 upgrade, not
 * claimed here.
 */

export const OPENAI_VOICE_PROVIDER_ID = "openai";

/** Upper bound on uploaded turn audio (~5 MB ≈ several minutes of opus/webm speech; Whisper caps at 25 MB). */
export const VOICE_MAX_AUDIO_BYTES = 5 * 1024 * 1024;
/** Upper bound on text handed to TTS (replies are already 2–5 sentences). */
export const VOICE_MAX_TTS_CHARS = 2000;

function sttModel(): string {
  return process.env.VOICE_STT_MODEL?.trim() || "whisper-1";
}

function ttsModel(): string {
  // VOICE_TTS_MODEL is canonical; OPENAI_TTS_MODEL accepted as a legacy alias
  // so an operator-set value can never silently fall back to a default while
  // a differently-named var holds an incompatible model id.
  return process.env.VOICE_TTS_MODEL?.trim() || process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
}

function ttsVoice(): string {
  // VOICE_TTS_VOICE is canonical; OPENAI_TTS_VOICE accepted as a legacy alias.
  return process.env.VOICE_TTS_VOICE?.trim() || process.env.OPENAI_TTS_VOICE?.trim() || "alloy";
}

/**
 * Whether an OpenAI speech model accepts the `instructions` field on
 * POST /v1/audio/speech.
 *
 * Per the OpenAI API reference (Create speech): "instructions ... Does not
 * work with tts-1 or tts-1-hd." Sending `instructions` to those legacy
 * models returns 400 [invalid_request_error] ("Unrecognized request argument
 * supplied: instructions"). Only the gpt-4o TTS family supports it.
 * Unknown models FAIL SAFE (no instructions) so a future/typo model id can
 * never produce this exact provider 400.
 */
export function ttsSupportsInstructions(model: string): boolean {
  return model.startsWith("gpt-4o-mini-tts") || model.startsWith("gpt-4o-tts");
}

/** Reject unknown/empty TTS model ids BEFORE the network call, with a config
 *  error that names the bad variable — instead of an opaque provider 400.
 *  A frequent misconfiguration is OPENAI_MODEL (chat, e.g. "gpt-4o-mini")
 *  copied into the TTS slot; that id is rejected here explicitly. */
export function validateTtsModel(model: string): void {
  if (!model) throw new Error("Voice TTS model is not configured. Check VOICE_TTS_MODEL.");
  if (model === "tts-1" || model === "tts-1-hd") return;
  if (model.startsWith("gpt-4o-mini-tts") || model.startsWith("gpt-4o-tts")) return;
  throw new Error(
    `Voice TTS model "${model}" is not a supported OpenAI speech model. Use tts-1, tts-1-hd, or gpt-4o-mini-tts. Check VOICE_TTS_MODEL.`
  );
}

/** Built-in OpenAI voices. tts-1/tts-1-hd support only the original 9;
 *  the gpt-4o TTS family supports all 13 (alloy, ash, ballad, coral, echo,
 *  fable, onyx, nova, sage, shimmer, verse, marin, cedar). A Kokoro voice id
 *  (e.g. hf_alpha) or a newer voice on a legacy model is rejected here with
 *  a clear config error instead of a provider invalid_request_error. */
const TTS_LEGACY_VOICES = new Set([
  "alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer",
]);
const TTS_ALL_VOICES = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage",
  "shimmer", "verse", "marin", "cedar",
]);

export function validateTtsVoice(model: string, voice: string): void {
  if (!voice) throw new Error("Voice TTS voice is not configured. Check VOICE_TTS_VOICE.");
  const allowed = model.startsWith("tts-1") ? TTS_LEGACY_VOICES : TTS_ALL_VOICES;
  if (!allowed.has(voice)) {
    throw new Error(
      `Voice voice "${voice}" is not supported by TTS model "${model}". Check VOICE_TTS_VOICE.`
    );
  }
}

function turnTimeoutMs(): number {
  const raw = Number(process.env.VOICE_TURN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 5_000 && raw <= 120_000 ? raw : 60_000;
}

export function openAIVoiceIsConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** Language hint for Whisper (ISO-639-1), or null to omit the field and let
 *  Whisper auto-detect. Hinglish is code-mixed speech: Whisper auto-detects
 *  it best with a Hindi hint; the detected language is recorded from the
 *  response, never asserted. Codes outside Whisper's supported set (e.g.
 *  "or"/Odia, non-ISO tags like "hinglish"/"rajasthani" unmapped) return
 *  null — sending an unsupported `language` value to
 *  POST /v1/audio/transcriptions returns 400 invalid_request_error, so the
 *  field is omitted instead of faked. */
const WHISPER_LANGUAGES = new Set([
  "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs",
  "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi",
  "fo", "fr", "gl", "gu", "ha", "he", "hi", "hr", "ht", "hu", "hy", "id",
  "is", "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb", "ln",
  "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt", "my",
  "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru", "sa",
  "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw", "ta",
  "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "yi",
  "yo", "zh",
]);

export function sttLanguageHint(language: VoiceLanguage): string | null {
  if (language === "hinglish") return "hi";
  if (language === "rajasthani") return null;
  if (/^[a-z]{2}$/.test(language)) return WHISPER_LANGUAGES.has(language) ? language : null;
  return "en";
}

/** Spoken-language instruction for TTS. English keeps the exact legacy
 *  request (no `instructions` key); Hindi/Hinglish get an explicit accent
 *  instruction so the voice matches the reply language. The instruction is
 *  only ATTACHED for models in ttsSupportsInstructions() — callers MUST
 *  gate on the model, because tts-1/tts-1-hd reject the field outright.
 *  Language routing itself always survives (reply text + voice selection);
 *  only the unsupported parameter is dropped. */
function ttsInstructions(language: VoiceLanguage): string | null {
  if (language === "hi") return "Speak Hindi. Use Devanagari pronunciation and a natural Indian accent.";
  if (language === "hinglish") return "Speak Hinglish: Hindi-English code-mix with a natural Indian accent.";
  return null;
}

function toError(status: number | null, op: "transcription" | "synthesis"): Error {
  if (status === 401 || status === 403) return new Error(`Voice ${op} is not authorized. Check the server voice configuration.`);
  if (status === 429) return new Error(`Voice ${op} is rate-limited right now. Please try again shortly.`);
  if (status === 408 || status === null) return new Error(`Voice ${op} timed out. Please try again.`);
  return new Error(`Voice ${op} failed. Please try again.`);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const timeout = new Error("Voice provider request timed out.");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export class OpenAIVoiceProvider implements VoiceProvider {
  readonly id = OPENAI_VOICE_PROVIDER_ID;
  readonly mode = "live" as const;
  readonly label = "OpenAI voice (Whisper + TTS, server relay)";

  private key(): string {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("Voice provider is not configured.");
    return key;
  }

  /** Transcribe turn audio (or pass typed text through, marked accordingly).
   *  Returns transcript + detected-language metadata for the session. */
  async prepareTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
    // Fail closed on every live path — even typed turns require the key, so
    // "live" mode can never silently operate unconfigured like mock does.
    this.key();
    if (input.audioBase64) {
      const transcript = await this.transcribe(input.audioBase64, input.audioMimeType ?? undefined, input.language);
      return transcript;
    }
    const transcriptText = input.transcriptText.trim();
    if (!transcriptText) throw new Error("Empty voice transcript.");
    if (transcriptText.length > 2000) throw new Error("Voice transcript too long.");
    return {
      transcriptText,
      language: input.language,
      mock: false,
      processingNote: "Live provider: typed transcript (no audio in this turn).",
      providerMetadata: { provider: OPENAI_VOICE_PROVIDER_ID, audioProcessedBy: "none (typed input)" },
    };
  }

  private async transcribe(
    audioBase64: string,
    audioMimeType: string | undefined,
    language: VoiceLanguage
  ): Promise<VoiceTurnResult> {
    const bytes = Buffer.from(audioBase64, "base64");
    if (bytes.length === 0) throw new Error("Empty voice audio.");
    if (bytes.length > VOICE_MAX_AUDIO_BYTES) throw new Error("Voice audio is too long. Please send a shorter message.");
    const mime = (audioMimeType || "audio/webm").split(";")[0].trim() || "audio/webm";

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), "turn.webm");
    form.append("model", sttModel());
    const hint = sttLanguageHint(language);
    if (hint) form.append("language", hint);
    form.append("response_format", "verbose_json");

    // STT pipeline trace (dev only): field names, sizes, and statuses — never
    // audio bytes, transcripts, or credentials.
    const devLog = (message: string) => {
      if (process.env.NODE_ENV !== "production") console.debug(`[voice] STT ${message}`);
    };
    devLog(`request started: endpoint=/v1/audio/transcriptions model=${sttModel()} bytes=${bytes.length} mime=${mime} languageHint=${hint ?? "(auto)"}`);

    let res: Response;
    try {
      res = await fetchWithTimeout(
        "https://api.openai.com/v1/audio/transcriptions",
        { method: "POST", headers: { authorization: `Bearer ${this.key()}` }, body: form },
        turnTimeoutMs()
      );
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw toError(null, "transcription");
      throw new Error("Voice transcription failed. Please try again.");
    }
    devLog(`response received: httpStatus=${res.status}`);
    if (!res.ok) {
      devLog(`provider error: httpStatus=${res.status} (body intentionally not logged)`);
      throw toError(res.status, "transcription");
    }
    const data = (await res.json().catch(() => null)) as { text?: unknown; language?: unknown } | null;
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) {
      devLog("empty transcript returned (upload succeeded, no speech detected)");
      throw new Error("Voice transcription produced no text. Please try again.");
    }
    devLog(`transcript returned: chars=${text.length}`);
    const detectedLanguage = typeof data?.language === "string" ? data.language : null;
    return {
      transcriptText: text,
      language,
      mock: false,
      processingNote: "Live provider: browser audio transcribed server-side (Whisper); raw audio is not stored.",
      providerMetadata: {
        provider: OPENAI_VOICE_PROVIDER_ID,
        audioProcessedBy: `whisper (${sttModel()})`,
        audioBytes: bytes.length,
        detectedLanguage,
      },
    };
  }

  /** Synthesize the Basera reply to MP3 audio (base64 for the browser). */
  async synthesizeReply(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult> {
    this.key();
    const text = input.replyText.trim().slice(0, VOICE_MAX_TTS_CHARS);
    if (!text) throw new Error("Nothing to synthesize.");
    const model = ttsModel();
    const voice = ttsVoice();
    // Fail fast on misconfiguration with a named-variable error instead of
    // letting an invalid model/voice reach the provider as a 400
    // invalid_request_error surfaced only as "Voice synthesis failed."
    validateTtsModel(model);
    validateTtsVoice(model, voice);
    const startedAt = Date.now();
    // `instructions` is model-gated: gpt-4o TTS honors it; tts-1/tts-1-hd
    // REJECT it with invalid_request_error, so it must be omitted there.
    // Hindi/Hinglish routing is preserved via the reply text itself (already
    // in the target language) — only the unsupported parameter is dropped.
    const instructions = ttsSupportsInstructions(model) ? ttsInstructions(input.language) : null;
    let res: Response;
    try {
      res = await fetchWithTimeout(
        "https://api.openai.com/v1/audio/speech",
        {
          method: "POST",
          headers: { authorization: `Bearer ${this.key()}`, "content-type": "application/json" },
          body: JSON.stringify({
            model,
            voice,
            input: text,
            response_format: "mp3",
            ...(instructions ? { instructions } : {}),
          }),
        },
        turnTimeoutMs()
      );
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw toError(null, "synthesis");
      throw new Error("Voice synthesis failed. Please try again.");
    }
    if (!res.ok) throw toError(res.status, "synthesis");
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new Error("Voice synthesis failed. Please try again.");
    return {
      audioBase64: buffer.toString("base64"),
      audioMimeType: "audio/mpeg",
      mock: false,
      processingNote: "Live provider: reply synthesized server-side; raw audio is not stored.",
      providerMetadata: {
        provider: OPENAI_VOICE_PROVIDER_ID,
        voice,
        model,
        responseBytes: buffer.length,
        requestMs: Date.now() - startedAt,
      },
    };
  }
}
