import "server-only";

import {
  type VoiceProvider,
  type VoiceTurnInput,
  type VoiceTurnResult,
} from "./voice-provider";
import { toPlayableWav } from "./gemini-voice-provider";

/**
 * GEMINI 3.8 FLASH-LITE TTS PROVIDER.
 *
 * REST API-based TTS using Gemini 3.8 Flash-Lite.
 * Input: final Basera response text → Output: WAV audio (base64).
 *
 * Transport: generateContent (v1beta) with responseModalities: ["AUDIO"].
 * No streaming hold-open: each turn is one bounded TTS call.
 */

export const GEMINI_TTS_PROVIDER_ID = "gemini-tts";

export const GEMINI_TTS_SAMPLE_RATE = 24000;

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("Voice TTS provider is not configured.");
  return key;
}

export function geminiTtsIsConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function ttsModel(): string {
  const model = process.env.GEMINI_TTS_MODEL?.trim() || "gemini-3.8-flash-lite-tts";
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

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      const timeout = new Error("Voice TTS request timed out.");
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

function toError(status: number | null, body?: unknown): Error {
  if (status === 401 || status === 403) return new Error("Voice TTS is not authorized. Check the server voice configuration.");
  if (status === 429) {
    const msg = body && typeof body === "object" && "error" in body
      ? String((body as { error?: { message?: unknown } }).error?.message || "")
      : "";
    if (/quota|resource.exhausted|exhausted/i.test(msg)) {
      return new Error("Voice TTS quota exhausted. Please try again later.");
    }
    return new Error("Voice TTS is rate-limited right now. Please try again shortly.");
  }
  if (status === 408 || status === null) return new Error("Voice TTS timed out. Please try again.");
  return new Error("Voice TTS failed. Please try again.");
}

/** Wrap raw 16-bit mono PCM in a WAV container for browser playback. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
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

export interface TtsSynthesizeInput {
  replyText: string;
  language: "en" | "hi" | "hinglish";
  conversationId: string;
}

export interface TtsSynthesizeResult {
  audioBase64: string | null;
  audioMimeType: string | null;
  mock: boolean;
  processingNote: string;
  providerMetadata: Record<string, unknown>;
}

export class GeminiTtsProvider implements VoiceProvider {
  readonly id = GEMINI_TTS_PROVIDER_ID;
  readonly mode = "live" as const;
  readonly label = "Gemini TTS (3.8 Flash-Lite, server-side)";

  private key(): string {
    return apiKey();
  }

  /** This provider is TTS-only. It does not handle full voice turns (STT + pipeline + TTS). */
  async prepareTurn(_input: VoiceTurnInput): Promise<VoiceTurnResult> {
    throw new Error("Gemini TTS provider is TTS-only. Use a full voice provider (OpenAI, Gemini Voice) for turns.");
  }

  /** Synthesize the Basera reply to WAV audio (base64 for the browser). */
  async synthesizeReply(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
    this.key();
    const text = input.replyText.trim().slice(0, 2000);
    if (!text) throw new Error("Nothing to synthesize.");

    const startedAt = Date.now();
    let res: Response;

    try {
      res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ttsModel())}:generateContent`,
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
        turnTimeoutMs()
      );
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw new Error("Voice TTS timed out. Please try again.");
      throw new Error("Voice TTS failed. Please try again.");
    }

    let resBody: unknown = null;
    if (!res.ok) {
      resBody = await res.json().catch(() => null);
      throw toError(res.status, resBody);
    }

    const data = (await res.json().catch(() => null)) as GenerateContentResponse | null;
    const audio = extractInlineAudio(data);
    if (!audio || audio.bytes.length === 0) {
      throw new Error("Voice TTS did not return audio. Check the server voice configuration.");
    }

    const wav = toPlayableWav(audio.bytes, audio.mimeType);
    return {
      audioBase64: wav.toString("base64"),
      audioMimeType: "audio/wav",
      mock: false,
      processingNote: "TTS: reply synthesized server-side (Gemini 3.8 Flash-Lite); raw audio is not stored.",
      providerMetadata: {
        provider: GEMINI_TTS_PROVIDER_ID,
        voice: ttsVoice(),
        model: ttsModel(),
        responseBytes: wav.length,
        requestMs: Date.now() - startedAt,
      },
    };
  }
}