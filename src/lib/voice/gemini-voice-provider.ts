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
 * GEMINI VOICE PROVIDER (low-cost/free-tier live voice).
 *
 * Server-relayed speech turns over the SAME Basera turn pipeline:
 *   browser mic audio → Gemini transcription (server-side)
 *     → processInboundMessage (unchanged Basera brain)
 *     → Gemini speech synthesis (server-side)
 *     → audio back to the browser for playback.
 *
 * Transport: Gemini generateContent (v1beta) for both directions — text out
 * for STT (verbatim transcript parsing), AUDIO modality for TTS (PCM
 * wrapped to WAV here, no client dependency). No second voice system: this
 * adapter implements the same VoiceProvider interface as the OpenAI/Kokoro
 * adapters, selected explicitly via VOICE_PROVIDER=gemini. Providers NEVER
 * fall back to each other (that would create surprise API costs).
 *
 * SECURITY: GEMINI_API_KEY lives server-side only and travels exclusively
 * in the x-goog-api-key header (never in URLs, bodies, logs, responses, or
 * client bundles). Errors surfaced to callers are status-shaped and generic
 * — provider bodies are never forwarded (they could theoretically echo
 * request data) and transcripts are never logged.
 *
 * LANGUAGE: transcription is automatic — the model is instructed to return
 * the transcript verbatim in whatever language was spoken (English,
 * Devanagari Hindi, or Roman-script Hinglish). No language parameter is
 * forced; the detected language is recorded from the pipeline, never
 * asserted here. TTS pronounces the reply text as written (single neutral
 * voice); language routing survives via the reply text itself.
 *
 * COST CONTROL: audio input is byte-capped before upload; TTS input is the
 * already-concise AI reply; every turn still counts against the existing
 * per-session/per-IP voice rate limits. No streaming hold-open: each turn
 * is one bounded STT call plus one bounded TTS call.
 */

export const GEMINI_VOICE_PROVIDER_ID = "gemini";

/** Upper bound on uploaded turn audio (matches the OpenAI adapter). */
export const GEMINI_VOICE_MAX_AUDIO_BYTES = 5 * 1024 * 1024;
/** Upper bound on text handed to TTS (replies are already 2–5 sentences). */
export const GEMINI_VOICE_MAX_TTS_CHARS = 2000;
/** Gemini native TTS output: 16-bit mono PCM at 24 kHz. */
export const GEMINI_TTS_SAMPLE_RATE = 24000;

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("Voice provider is not configured.");
  return key;
}

export function geminiVoiceIsConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function sttModel(): string {
  // Verified transcription-capable and reachable on the free tier. The Gemini
  // free tier caps generative requests PER MODEL per day (20/day on the flash
  // aliases), so the default is a cheap alias; override via GEMINI_STT_MODEL
  // to spread load or to pin an exact model.
  const model = process.env.GEMINI_STT_MODEL?.trim() || "gemini-flash-lite-latest";
  if (!model) throw new Error("Voice STT model is not configured. Check GEMINI_STT_MODEL.");
  return model;
}

function ttsModel(): string {
  // The 2.5 TTS preview models are legacy and rejected on current API
  // versions. Default returns a complete WAV container; override via
  // GEMINI_TTS_MODEL (a raw-PCM model such as gemini-3.1-flash-tts-preview is
  // also handled — the WAV header is added only when it is missing).
  const model = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-tts";
  if (!model) throw new Error("Voice TTS model is not configured. Check GEMINI_TTS_MODEL.");
  return model;
}

function ttsVoice(): string {
  return process.env.GEMINI_TTS_VOICE?.trim() || "Kore";
}

function turnTimeoutMs(): number {
  const raw = Number(process.env.VOICE_TURN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 5_000 && raw <= 120_000 ? raw : 60_000;
}

/** Browser/MediaRecorder MIME types Gemini audio input accepts. Anything
 *  else fails fast with a named-variable-style config error instead of an
 *  opaque provider 400. Parameters (e.g. ";codecs=opus") are stripped. */
const STT_ACCEPT_MIMES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac",
]);

export function normalizeSttMime(raw: string | undefined): string {
  const mime = (raw || "audio/webm").split(";")[0].trim().toLowerCase() || "audio/webm";
  if (!STT_ACCEPT_MIMES.has(mime)) {
    throw new Error(`Voice audio format "${mime}" is not supported for transcription. Use WebM, MP3, MP4, OGG, WAV, AAC, or FLAC.`);
  }
  return mime;
}

/** Upstream statuses that mean "busy, try again shortly" rather than
 *  "misconfigured". Google answers free-tier capacity spikes with
 *  503 UNAVAILABLE ("This model is currently experiencing high demand"),
 *  which is transient and resolved by a single retried request. */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

function isTransientStatus(status: number | null): boolean {
  return status !== null && TRANSIENT_STATUSES.has(status);
}

/** True when a body describes a quota/rate-limit condition (429 or RESOURCE_EXHAUSTED). */
function isQuotaBody(body: unknown): boolean {
  const msg = body && typeof body === "object" && "error" in body
    ? String((body as { error?: { message?: unknown } }).error?.message || "")
    : "";
  return /quota|resource\.exhausted|exhausted|rate limit|rate-limit/i.test(msg);
}

function toError(status: number | null, op: "transcription" | "synthesis", body?: unknown): Error {
  if (status === 401 || status === 403) return new Error(`Voice ${op} is not authorized. Check the server voice configuration.`);
  if (status === 429) {
    if (isQuotaBody(body)) {
      return new Error(`Voice ${op} quota exhausted. Please try again later.`);
    }
    return new Error(`Voice ${op} is rate-limited right now. Please try again shortly.`);
  }
  if (status === 408 || status === null) return new Error(`Voice ${op} timed out. Please try again.`);
  // Capacity spike: transient, so the client keeps the session alive and retries
  // on the next turn instead of tearing the conversation down.
  if (isTransientStatus(status)) {
    return new Error(`Voice ${op} is temporarily unavailable (provider capacity). Please try again shortly.`);
  }
  if (status !== null && status >= 500) {
    return new Error(`Voice ${op} failed temporarily. Please try again shortly.`);
  }
  // 400/422: the provider refused this payload (unsupported container, or a
  // truncated/empty clip). Retrying the same bytes cannot help, but the user
  // simply speaking again can — so it must not be treated as a fatal error.
  if (status === 400 || status === 422) {
    return new Error(`Voice ${op} was rejected by the audio provider (unsupported or unreadable audio). Please try again.`);
  }
  return new Error(`Voice ${op} failed. Please try again.`);
}

/** One bounded retry for transient upstream capacity errors. Never retries
 *  auth, quota, or request-shape failures (those would only fail again). */
const TRANSIENT_RETRY_DELAYS_MS = [600];

async function fetchWithTransientRetry(
  url: string,
  init: RequestInit,
  ms: number,
  op: "transcription" | "synthesis"
): Promise<Response> {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAYS_MS[attempt - 1]));
    }
    const res = await fetchWithTimeout(url, init, ms);
    if (!isTransientStatus(res.status)) return res;
    last = res;
  }
  // Keep the throttle classification so callers can distinguish "busy, retry"
  // from a hard failure instead of flattening it into a generic error.
  const err = toError(last ? last.status : null, op);
  throw asThrottleError(err) ?? err;
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

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; inlineData?: { mimeType?: unknown; data?: unknown } }> } }>;
  error?: { message?: unknown };
}

function extractText(data: GenerateContentResponse | null): string {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
  return text;
}

function extractInlineAudio(data: GenerateContentResponse | null): { bytes: Buffer; mimeType: string } | null {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const mime = p.inlineData?.mimeType;
    const b64 = p.inlineData?.data;
    if (typeof mime === "string" && typeof b64 === "string" && b64.length > 0) {
      return { bytes: Buffer.from(b64, "base64"), mimeType: mime };
    }
  }
  return null;
}

/** Wrap raw 16-bit mono PCM in a WAV container for browser playback. Pure
 *  and unit-testable (header bytes assertable). */
export function pcmToWav(pcm: Buffer, sampleRate = GEMINI_TTS_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** True when the payload already carries a complete RIFF/WAVE container. */
export function isWavContainer(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
}

/** Read the sample rate out of a Gemini inline-audio mime type
 *  (e.g. "audio/L16;codec=pcm;rate=24000"). Falls back to 24 kHz. */
function sampleRateFromMime(mimeType: string | null | undefined): number {
  const m = /rate=(\d+)/i.exec(mimeType || "");
  const rate = m ? Number(m[1]) : NaN;
  return Number.isFinite(rate) && rate >= 8000 && rate <= 96_000 ? rate : GEMINI_TTS_SAMPLE_RATE;
}

/**
 * Normalize Gemini TTS output into a playable WAV container.
 *
 * Gemini's TTS models are inconsistent: some return raw 16-bit mono PCM
 * (audio/L16;codec=pcm;rate=24000), while others already return a finished
 * WAV (audio/wav, RIFF magic). Wrapping an existing container again produces
 * a nested/invalid file that browsers refuse to decode — i.e. silent playback.
 * So: pass containers through untouched, and only add a header to raw PCM.
 */
export function toPlayableWav(bytes: Buffer, mimeType?: string | null): Buffer {
  if (isWavContainer(bytes)) return bytes;
  return pcmToWav(bytes, sampleRateFromMime(mimeType));
}

/** Same-vendor models tried after the primary one is throttled. Gemini's free
 *  tier enforces a PER-MODEL daily request cap (measured: ~20/day on the flash
 *  aliases, ~10/day on the TTS models) and answers capacity spikes with 503
 *  UNAVAILABLE, so a single default model stops working partway through the
 *  day. Falling back stays inside the same vendor and the same free tier, so it
 *  never creates surprise cost. Override or disable with the env vars below. */
const DEFAULT_STT_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash"];
const DEFAULT_TTS_FALLBACK_MODELS = ["gemini-3.1-flash-tts-preview", "gemini-3.8-flash-tts"];

/** Primary first, then fallbacks. When the env var is PRESENT its value is
 *  authoritative (an empty value disables fallbacks entirely); when ABSENT the
 *  defaults above apply. */
function resolveModelChain(primary: string, envVar: string, defaults: string[]): string[] {
  const raw = process.env[envVar];
  const extras = raw === undefined ? defaults : raw.split(",").map((m) => m.trim()).filter(Boolean);
  return Array.from(new Set([primary, ...extras]));
}

function sttModels(): string[] {
  return resolveModelChain(sttModel(), "GEMINI_STT_FALLBACK_MODELS", DEFAULT_STT_FALLBACK_MODELS);
}

function ttsModels(): string[] {
  return resolveModelChain(ttsModel(), "GEMINI_TTS_FALLBACK_MODELS", DEFAULT_TTS_FALLBACK_MODELS);
}

/** A provider failure that another model of the same vendor might not hit
 *  (quota exhausted, throttled, or a capacity spike). Auth failures and bad
 *  request shapes are NOT retryable this way. */
class ThrottleError extends Error {}

function asThrottleError(err: unknown): ThrottleError | null {
  if (!(err instanceof Error)) return null;
  // Timeouts count: free-tier audio turns can exceed the per-request budget on
  // one model while another answers in time, so a slow model must hand the turn
  // to the next one instead of failing the whole turn (the chat client already
  // continues on timeout).
  if (
    !/quota|rate-limited|rate limit|temporarily unavailable|provider capacity|failed temporarily|resource\.exhausted|timed out|timeout/i.test(
      err.message
    )
  ) {
    return null;
  }
  return new ThrottleError(err.message);
}

export class GeminiVoiceProvider implements VoiceProvider {
  readonly id = GEMINI_VOICE_PROVIDER_ID;
  readonly mode = "live" as const;
  readonly label = "Gemini voice (STT + TTS, server relay)";

  private key(): string {
    return apiKey();
  }

  /** Transcribe turn audio (or pass typed text through, marked accordingly).
   *  Returns transcript + detected-language metadata for the session. */
  async prepareTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
    // Fail closed on every live path — even typed turns require the key, so
    // "live" mode can never silently operate unconfigured like mock does.
    this.key();
    if (input.audioBase64) {
      return this.transcribe(input.audioBase64, input.audioMimeType ?? undefined, input.language);
    }
    const transcriptText = input.transcriptText.trim();
    if (!transcriptText) throw new Error("Empty voice transcript.");
    if (transcriptText.length > 2000) throw new Error("Voice transcript too long.");
    return {
      transcriptText,
      language: input.language,
      mock: false,
      processingNote: "Live provider: typed transcript (no audio in this turn).",
      providerMetadata: { provider: GEMINI_VOICE_PROVIDER_ID, audioProcessedBy: "none (typed input)" },
    };
  }

  private async transcribe(
    audioBase64: string,
    audioMimeType: string | undefined,
    language: VoiceLanguage
  ): Promise<VoiceTurnResult> {
    const bytes = Buffer.from(audioBase64, "base64");
    if (bytes.length === 0) throw new Error("Empty voice audio.");
    if (bytes.length > GEMINI_VOICE_MAX_AUDIO_BYTES) throw new Error("Voice audio is too long. Please send a shorter message.");
    const mime = normalizeSttMime(audioMimeType);
    void language;

    let last: Error | null = null;
    for (const model of sttModels()) {
      try {
        return await this.transcribeWithModel(model, bytes, mime, language);
      } catch (err) {
        // Only throttling moves on to the next model; anything else (bad key,
        // unreadable audio, bad request) would fail identically everywhere.
        const throttle = asThrottleError(err);
        if (!throttle) throw err;
        last = throttle;
      }
    }
    throw last ?? new Error("Voice transcription failed. Please try again.");
  }

  private async transcribeWithModel(
    model: string,
    bytes: Buffer,
    mime: string,
    language: VoiceLanguage
  ): Promise<VoiceTurnResult> {
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetchWithTransientRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": this.key(), "content-type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: "Transcribe the speech in this audio verbatim. Respond with ONLY the transcript, no commentary. The speech may be English, Hindi in Devanagari script, or Hindi-English code-mixed Hinglish in Roman script — transcribe exactly what you hear.",
                  },
                  { inlineData: { mimeType: mime, data: bytes.toString("base64") } },
                ],
              },
            ],
            generationConfig: { temperature: 0, maxOutputTokens: 512 },
          }),
        },
        turnTimeoutMs(),
        "transcription"
      );
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw toError(null, "transcription");
      // Preserve the throttle classification from the retry helper: swallowing
      // it here would downgrade a capacity spike to an opaque hard failure.
      if (err instanceof ThrottleError) throw err;
      throw new Error("Voice transcription failed. Please try again.");
    }
    let resBody: unknown = null;
    if (!res.ok) {
      resBody = await res.json().catch(() => null);
      throw toError(res.status, "transcription", resBody);
    }
    const data = (await res.json().catch(() => null)) as GenerateContentResponse | null;
    const text = extractText(data);
    if (!text) throw new Error("Voice transcription produced no text. Please try again.");
    return {
      transcriptText: text,
      language,
      mock: false,
      processingNote: "Live provider: browser audio transcribed server-side (Gemini); raw audio is not stored.",
      providerMetadata: {
        provider: GEMINI_VOICE_PROVIDER_ID,
        audioProcessedBy: `gemini (${model})`,
        audioBytes: bytes.length,
        requestMs: Date.now() - startedAt,
      },
    };
  }

  /** Synthesize the Basera reply to WAV audio (base64 for the browser). */
  async synthesizeReply(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult> {
    this.key();
    const text = input.replyText.trim().slice(0, GEMINI_VOICE_MAX_TTS_CHARS);
    if (!text) throw new Error("Nothing to synthesize.");

    let last: Error | null = null;
    for (const model of ttsModels()) {
      try {
        return await this.synthesizeWithModel(model, text);
      } catch (err) {
        const throttle = asThrottleError(err);
        if (!throttle) throw err;
        last = throttle;
      }
    }
    throw last ?? new Error("Voice synthesis failed. Please try again.");
  }

  private async synthesizeWithModel(model: string, text: string): Promise<VoiceSynthesizeResult> {
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetchWithTransientRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": this.key(), "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: ttsVoice() } } },
            },
          }),
        },
        turnTimeoutMs(),
        "synthesis"
      );
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw toError(null, "synthesis");
      if (err instanceof ThrottleError) throw err;
      throw new Error("Voice synthesis failed. Please try again.");
    }
    let resBody: unknown = null;
    if (!res.ok) {
      resBody = await res.json().catch(() => null);
      throw toError(res.status, "synthesis", resBody);
    }
    const data = (await res.json().catch(() => null)) as GenerateContentResponse | null;
    const audio = extractInlineAudio(data);
    if (!audio || audio.bytes.length === 0) {
      // The model answered with text (or nothing) instead of audio: report
      // clearly instead of returning fake silence.
      throw new Error("Voice synthesis did not return audio. Check the server voice configuration.");
    }
    const wav = toPlayableWav(audio.bytes, audio.mimeType);
    return {
      audioBase64: wav.toString("base64"),
      audioMimeType: "audio/wav",
      mock: false,
      processingNote: "Live provider: reply synthesized server-side; raw audio is not stored.",
      providerMetadata: {
        provider: GEMINI_VOICE_PROVIDER_ID,
        voice: ttsVoice(),
        model,
        responseBytes: wav.length,
        requestMs: Date.now() - startedAt,
      },
    };
  }
}
