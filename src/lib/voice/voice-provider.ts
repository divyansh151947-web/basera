import "server-only";

/**
 * VOICE PROVIDER ABSTRACTION (Voice AI Phase 1).
 *
 * The application NEVER talks to a voice vendor directly. Everything goes
 * through this interface, so a realtime provider (Phase 2+) can be added as
 * a new adapter without touching session logic, APIs, or UI.
 *
 * MODES (explicit, never blurred):
 * - "mock": development stand-in. Accepts transcript TEXT (standing in for
 *   future STT output) and returns the AI reply TEXT (standing in for future
 *   TTS input). It performs NO audio processing and MUST say so on every
 *   result. Used for local development and automated tests.
 * - "live": a real provider adapter. Phase 1 ships NO live adapter — asking
 *   for one fails closed with a clear error instead of silently mocking.
 */

/** Languages the voice layer tags on turns. India-first codes are included
 *  so they flow EXPLICITLY to adapters (which validate against verified
 *  coverage) instead of being silently remapped to English. Recognition /
 *  synthesis quality per language depends entirely on the live provider and
 *  is NEVER claimed here — see voice-languages.ts for verified statuses. */
export type VoiceLanguage =
  | "en"
  | "hi"
  | "hinglish"
  | "mr"
  | "bn"
  | "gu"
  | "pa"
  | "ta"
  | "te"
  | "kn"
  | "ml"
  | "or"
  | "as"
  | "ur"
  | "rajasthani"
  | "es"
  | "fr"
  | "it"
  | "ja"
  | "zh"
  | "pt";

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  "en",
  "hi",
  "hinglish",
  "mr",
  "bn",
  "gu",
  "pa",
  "ta",
  "te",
  "kn",
  "ml",
  "or",
  "as",
  "ur",
  "rajasthani",
  "es",
  "fr",
  "it",
  "ja",
  "zh",
  "pt",
];

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return (VOICE_LANGUAGES as string[]).includes(value as string);
}

export type VoiceProviderMode = "mock" | "live";

export interface VoiceTurnInput {
  /** Transcript text (mock mode: typed/pasted by the developer or tests). */
  transcriptText: string;
  language: VoiceLanguage;
  conversationId: string;
  leadId: string;
  /** Phase 2: browser-captured audio for live server-side transcription.
   *  The mock provider rejects audio (it processes no audio, honestly). */
  audioBase64?: string | null;
  audioMimeType?: string | null;
}

export interface VoiceTurnResult {
  transcriptText: string;
  language: VoiceLanguage;
  /** True ONLY for the mock stand-in. */
  mock: boolean;
  /** Human-readable processing statement (e.g. what did/did not happen). */
  processingNote: string;
  providerMetadata: Record<string, unknown>;
}

export interface VoiceSynthesizeInput {
  replyText: string;
  language: VoiceLanguage;
  conversationId: string;
}

export interface VoiceSynthesizeResult {
  /** Audio payload when a live provider produces one; ALWAYS null in mock. */
  audioBase64: string | null;
  audioMimeType: string | null;
  mock: boolean;
  processingNote: string;
  /** Latency/voice/model telemetry (result object only — never log spam). */
  providerMetadata: Record<string, unknown>;
}

export interface VoiceProvider {
  readonly id: string;
  readonly mode: VoiceProviderMode;
  readonly label: string;
  prepareTurn(input: VoiceTurnInput): Promise<VoiceTurnResult>;
  synthesizeReply(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult>;
}

/** Resolves which provider the server should use. Defaults to mock; NEVER
 *  falls back to mock when live is requested (fail closed, no fake calls). */
export function getVoiceProviderName(env: Record<string, string | undefined> = process.env): string {
  return (env.VOICE_PROVIDER ?? "mock").trim().toLowerCase() || "mock";
}

/** TTS-only provider ID for the new cascade (Gemini 3.8 Flash-Lite TTS). */
export const GEMINI_TTS_PROVIDER_ID = "gemini-tts";

/** Transcribe Live provider ID for the new cascade (Gemini 3.5 Transcribe Live). */
export const GEMINI_TRANSCRIBE_LIVE_PROVIDER_ID = "gemini-transcribe-live";
