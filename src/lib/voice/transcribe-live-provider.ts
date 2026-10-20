import "server-only";

/**
 * GEMINI TRANSCRIBE LIVE PROVIDER (STT) - SERVER SIDE ONLY.
 *
 * Server-side utilities for Gemini 3.5 Transcribe Live.
 * The actual WebSocket client runs in the browser (see transcribe-live-client.ts).
 *
 * This module provides:
 * - Token minting for Transcribe Live
 * - Setup frame building
 * - Model configuration
 */

export const TRANSCRIBE_LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";

/** Verified working Transcribe Live model. Override via GEMINI_TRANSCRIBE_LIVE_MODEL. */
export const TRANSCRIBE_LIVE_DEFAULT_MODEL = "models/gemini-3.5-transcribe-live";

export function transcribeLiveModelId(env: Record<string, string | undefined> = process.env): string {
  return env.GEMINI_TRANSCRIBE_LIVE_MODEL?.trim() || TRANSCRIBE_LIVE_DEFAULT_MODEL;
}

/** VAD config for Transcribe Live — high sensitivity for quiet/fast speech, generous silence window. */
export const TRANSCRIBE_LIVE_VAD_CONFIG = {
  disabled: false,
  startSensitivity: "START_SENSITIVITY_HIGH",
  endSensitivity: "END_SENSITIVITY_HIGH",
  prefixPaddingMs: 300,
  silenceDurationMs: 1000,
} as const;

/** System instruction for Transcribe Live — transcription only, no tools. */
export function buildTranscribeLiveSetup(model: string, language?: string): object {
  const languageInstruction = language
    ? `The user may speak ${language}. Transcribe in that language.`
    : "The user may speak English, Hindi (Devanagari), or Hinglish (Roman script). Automatically detect and transcribe in the correct script.";

  return {
    setup: {
      model,
      generationConfig: { responseModalities: ["TEXT"] },
      systemInstruction: {
        parts: [{ text: `You are a precise transcription engine. ${languageInstruction} Output ONLY the transcript, no commentary.` }],
      },
      realtimeInputConfig: {
        automaticActivityDetection: { ...TRANSCRIBE_LIVE_VAD_CONFIG },
      },
      inputAudioTranscription: {},
      // No tools, no output audio transcription
    },
  };
}