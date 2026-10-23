import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GEMINI_VOICE_MAX_AUDIO_BYTES,
  GeminiVoiceProvider,
  geminiVoiceIsConfigured,
  isWavContainer,
  normalizeSttMime,
  pcmToWav,
  toPlayableWav,
} from "./gemini-voice-provider";

const SAVED_KEY = process.env.GEMINI_API_KEY;

let calls: Array<{ url: string; init: RequestInit }> = [];
let handler: ((url: string, init: RequestInit) => Response | Promise<Response>) | null = null;

function setKey(value: string | undefined) {
  if (value === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = value;
}

function mockFetch() {
  calls = [];
  handler = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (!handler) throw new Error("No mock handler set.");
      return handler(url, init);
    })
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sttResponse(text: string): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function ttsResponse(pcmBytes: Buffer): Response {
  return jsonResponse({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: pcmBytes.toString("base64") } }] } }],
  });
}

beforeEach(() => {
  mockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (SAVED_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = SAVED_KEY;
});

describe("gemini voice provider (mocked transport — key never leaves test)", () => {
  it("missing key fails closed before any network call", async () => {
    setKey(undefined);
    expect(geminiVoiceIsConfigured()).toBe(false);
    const provider = new GeminiVoiceProvider();
    await expect(
      provider.prepareTurn({ transcriptText: "hi", language: "en", conversationId: "c", leadId: "l" })
    ).rejects.toThrow(/not configured/i);
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /not configured/i
    );
    expect(calls).toHaveLength(0);
  });

  it("transcribes audio via generateContent with header auth (never URL/body/key echo)", async () => {
    setKey("test-gemini-key");
    handler = (url, init) => {
      expect(url).toContain("generativelanguage.googleapis.com/v1beta/models/");
      expect(url).toContain(":generateContent");
      expect(url).not.toContain("test-gemini-key");
      const headers = init.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe("test-gemini-key");
      const body = JSON.parse(init.body as string) as { contents: Array<{ parts: unknown[] }> };
      expect(body.contents[0].parts).toHaveLength(2);
      return sttResponse("मुझे जयपुर में 3 BHK चाहिए");
    };
    const provider = new GeminiVoiceProvider();
    const audio = Buffer.from("fake-audio-bytes").toString("base64");
    const result = await provider.prepareTurn({
      transcriptText: "",
      language: "hi",
      conversationId: "c",
      leadId: "l",
      audioBase64: audio,
      audioMimeType: "audio/webm",
    });
    expect(result.mock).toBe(false);
    expect(result.transcriptText).toBe("मुझे जयपुर में 3 BHK चाहिए");
    expect(JSON.stringify(result)).not.toContain("test-gemini-key");
  });

  it("empty transcript throws the no-text error (route maps it to 'could not hear')", async () => {
    setKey("test-gemini-key");
    handler = () => sttResponse("   ");
    const provider = new GeminiVoiceProvider();
    const audio = Buffer.from("x").toString("base64");
    await expect(
      provider.prepareTurn({ transcriptText: "", language: "en", conversationId: "c", leadId: "l", audioBase64: audio })
    ).rejects.toThrow(/produced no text/i);
  });

  it("provider errors map to safe generic errors without body echo", async () => {
    setKey("bad-key");
    handler = () => jsonResponse({ error: { message: "API key not valid: bad-key" } }, 400);
    const provider = new GeminiVoiceProvider();
    const audio = Buffer.from("x").toString("base64");
    await expect(
      provider.prepareTurn({ transcriptText: "", language: "en", conversationId: "c", leadId: "l", audioBase64: audio }).catch((e: Error) => {
        expect(e.message).not.toContain("bad-key");
        throw e;
      })
    ).rejects.toThrow();
    handler = () => jsonResponse({ error: "denied" }, 401);
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /not authorized/i
    );
  });

  it("oversize audio is rejected before upload", async () => {
    setKey("test-gemini-key");
    const provider = new GeminiVoiceProvider();
    const big = Buffer.alloc(GEMINI_VOICE_MAX_AUDIO_BYTES + 1).toString("base64");
    await expect(
      provider.prepareTurn({ transcriptText: "", language: "en", conversationId: "c", leadId: "l", audioBase64: big })
    ).rejects.toThrow(/too long/i);
    expect(calls).toHaveLength(0);
  });

  it("unsupported audio MIME fails fast with a clear error", () => {
    expect(() => normalizeSttMime("audio/xyz")).toThrow(/not supported/i);
    expect(normalizeSttMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeSttMime(undefined)).toBe("audio/webm");
  });

  it("synthesizes WAV audio with a valid RIFF header", async () => {
    setKey("test-gemini-key");
    const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    handler = async (url, init) => {
      expect(url).toContain(":generateContent");
      const body = JSON.parse(init.body as string) as { generationConfig: { responseModalities: string[] } };
      expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
      return ttsResponse(pcm);
    };
    const provider = new GeminiVoiceProvider();
    const result = await provider.synthesizeReply({ replyText: "Namaste!", language: "hi", conversationId: "c" });
    expect(result.mock).toBe(false);
    expect(result.audioMimeType).toBe("audio/wav");
    const wav = Buffer.from(result.audioBase64 as string, "base64");
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.length).toBe(44 + pcm.length);
  });

  it("text-instead-of-audio TTS response fails explicitly (no fake silence)", async () => {
    setKey("test-gemini-key");
    handler = () => sttResponse("hello (text, not audio)");
    const provider = new GeminiVoiceProvider();
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /did not return audio/i
    );
  });

  it("pcmToWav header bytes are exact", () => {
    const wav = pcmToWav(Buffer.from([0xaa, 0xbb]), 24000);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(2);
  });
});

/**
 * Gemini TTS returns EITHER a finished WAV (audio/wav) or raw 16-bit mono PCM
 * (audio/L16;codec=pcm;rate=24000), depending on the model. Wrapping an
 * existing container a second time produces a file browsers refuse to decode —
 * i.e. a reply that is never spoken. These tests pin both shapes.
 */
describe("toPlayableWav", () => {
  it("leaves an existing RIFF/WAVE container byte-identical", () => {
    const wav = pcmToWav(Buffer.from([1, 2, 3, 4]), 24000);
    expect(isWavContainer(wav)).toBe(true);
    const out = toPlayableWav(wav, "audio/wav");
    expect(out.equals(wav)).toBe(true);
    // A second wrapper would advertise a RIFF size 44 bytes larger than the file.
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
  });

  it("wraps raw PCM and honours the sample rate from the mime type", () => {
    const pcm = Buffer.from([0xaa, 0xbb, 0xcc]);
    expect(isWavContainer(pcm)).toBe(false);
    const out = toPlayableWav(pcm, "audio/L16;codec=pcm;rate=24000");
    expect(out.toString("ascii", 0, 4)).toBe("RIFF");
    expect(out.toString("ascii", 8, 12)).toBe("WAVE");
    expect(out.readUInt32LE(24)).toBe(24000);
    expect(out.length).toBe(44 + pcm.length);
  });

  it("falls back to 24 kHz when the mime type carries no rate", () => {
    const out = toPlayableWav(Buffer.from([1, 2]), "audio/l16");
    expect(out.readUInt32LE(24)).toBe(24000);
  });

  it("a double-wrapped file replaces the audio samples with a nested header", () => {
    // This is the real failure mode: the outer data chunk is the right length,
    // so the RIFF size still checks out — but its payload is the inner file's
    // "RIFF" header instead of PCM samples, so playback is a ~1 ms click.
    const samples = Buffer.alloc(24000, 0x7f); // 1s of 24 kHz mono PCM
    const inner = pcmToWav(samples, 24000);
    const doubled = pcmToWav(inner, 24000);

    expect(doubled.readUInt32LE(4)).toBe(doubled.length - 8); // size looks valid
    expect(doubled.toString("ascii", 44, 48)).toBe("RIFF"); // ...but the samples are a header
    expect(doubled.readUInt32LE(40)).toBe(inner.length); // ~47 bytes of "audio"

    // The fix produces genuine samples in the data region instead.
    const good = toPlayableWav(inner, "audio/wav");
    expect(good.equals(inner)).toBe(true);
    expect(good.readUInt32LE(40)).toBe(samples.length);
  });
});

describe("same-vendor model fallback (per-model daily free-tier caps)", () => {
  const SAVED = {
    stt: process.env.GEMINI_STT_MODEL,
    sttFallback: process.env.GEMINI_STT_FALLBACK_MODELS,
    tts: process.env.GEMINI_TTS_MODEL,
    ttsFallback: process.env.GEMINI_TTS_FALLBACK_MODELS,
  };

  afterEach(() => {
    for (const [k, v] of [
      ["GEMINI_STT_MODEL", SAVED.stt],
      ["GEMINI_STT_FALLBACK_MODELS", SAVED.sttFallback],
      ["GEMINI_TTS_MODEL", SAVED.tts],
      ["GEMINI_TTS_FALLBACK_MODELS", SAVED.ttsFallback],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("quota exhaustion falls back to another model of the same vendor", async () => {
    setKey("test-key");
    process.env.GEMINI_TTS_MODEL = "primary-tts";
    process.env.GEMINI_TTS_FALLBACK_MODELS = "secondary-tts";
    process.env.GEMINI_STT_MODEL = "primary-stt";
    process.env.GEMINI_STT_FALLBACK_MODELS = "secondary-stt";

    const seen: string[] = [];
    const quota = (): Response =>
      new Response(JSON.stringify({ error: { message: "Quota exceeded, limit: 10" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    handler = (url) => {
      seen.push(decodeURIComponent(url));
      if (url.includes("primary-")) return quota();
      if (url.includes("secondary-tts")) {
        return jsonResponse({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "audio/wav", data: pcmToWav(Buffer.from([1, 2]), 24000).toString("base64") } }] } },
          ],
        });
      }
      return sttResponse("a transcript");
    };

    const provider = new GeminiVoiceProvider();

    const tts = await provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" });
    expect(tts.mock).toBe(false);
    expect(tts.providerMetadata.model).toBe("secondary-tts");
    expect(tts.audioMimeType).toBe("audio/wav");
    expect(Buffer.from(tts.audioBase64 as string, "base64").toString("ascii", 0, 4)).toBe("RIFF");

    const stt = await provider.prepareTurn({
      transcriptText: "",
      language: "en",
      conversationId: "c",
      leadId: "l",
      audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      audioMimeType: "audio/wav",
    });
    expect(stt.providerMetadata.audioProcessedBy).toBe("gemini (secondary-stt)");

    expect(seen.some((m) => m.includes("primary-tts"))).toBe(true);
    expect(seen.some((m) => m.includes("secondary-tts"))).toBe(true);
  });

  it("a model that exceeds the turn budget hands the turn to the next model", async () => {
    setKey("test-key");
    process.env.GEMINI_STT_MODEL = "slow-stt";
    process.env.GEMINI_STT_FALLBACK_MODELS = "fast-stt";
    const seen: string[] = [];
    handler = (url) => {
      seen.push(decodeURIComponent(url));
      if (url.includes("slow-stt")) {
        // What fetchWithTimeout surfaces when the per-request budget expires.
        return Promise.reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
      }
      return sttResponse("heard clearly");
    };
    const provider = new GeminiVoiceProvider();
    const stt = await provider.prepareTurn({
      transcriptText: "",
      language: "en",
      conversationId: "c",
      leadId: "l",
      audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      audioMimeType: "audio/wav",
    });
    expect(stt.mock).toBe(false);
    expect(stt.transcriptText).toBe("heard clearly");
    expect(stt.providerMetadata.audioProcessedBy).toBe("gemini (fast-stt)");
    expect(seen.some((m) => m.includes("slow-stt"))).toBe(true);
    expect(seen.some((m) => m.includes("fast-stt"))).toBe(true);
  });

  it("the default STT chain contains only models that still serve this key", async () => {
    setKey("test-key");
    delete process.env.GEMINI_STT_MODEL;
    delete process.env.GEMINI_STT_FALLBACK_MODELS;
    const seen: string[] = [];
    handler = (url) => {
      seen.push(decodeURIComponent(url));
      if (url.includes("gemini-flash-lite-latest")) {
        return jsonResponse({ error: { message: "Quota exceeded, limit: 20" } }, 429);
      }
      return sttResponse("ok");
    };
    const provider = new GeminiVoiceProvider();
    const stt = await provider.prepareTurn({
      transcriptText: "",
      language: "en",
      conversationId: "c",
      leadId: "l",
      audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
      audioMimeType: "audio/wav",
    });
    expect(stt.transcriptText).toBe("ok");
    expect(stt.providerMetadata.audioProcessedBy).toBe("gemini (gemini-3.5-flash-lite)");
    expect(seen.join(",")).not.toMatch(/gemini-1\.5-flash|gemini-2\.5-flash/);
  });

  it("an empty fallback list disables fallback entirely", async () => {
    setKey("test-key");
    process.env.GEMINI_TTS_MODEL = "only-tts";
    process.env.GEMINI_TTS_FALLBACK_MODELS = "";
    handler = () => jsonResponse({ error: { message: "Quota exceeded, limit: 10" } }, 429);
    const provider = new GeminiVoiceProvider();
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /quota/i
    );
    expect(calls).toHaveLength(1);
  });

  it("does NOT fall back on an auth failure (every model would fail identically)", async () => {
    setKey("bad-key");
    process.env.GEMINI_TTS_MODEL = "primary-tts";
    process.env.GEMINI_TTS_FALLBACK_MODELS = "secondary-tts";
    handler = () => jsonResponse({ error: { message: "API key not valid" } }, 401);
    const provider = new GeminiVoiceProvider();
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /not authorized/i
    );
    expect(calls).toHaveLength(1);
  });

  it("a 503 capacity spike is reported as transient, not as a hard failure", async () => {
    setKey("test-key");
    process.env.GEMINI_STT_MODEL = "stt-only";
    process.env.GEMINI_STT_FALLBACK_MODELS = "";
    handler = () =>
      jsonResponse({ error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } }, 503);
    const provider = new GeminiVoiceProvider();
    await expect(
      provider.prepareTurn({
        transcriptText: "",
        language: "en",
        conversationId: "c",
        leadId: "l",
        audioBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
        audioMimeType: "audio/wav",
      })
    ).rejects.toThrow(/temporarily unavailable|provider capacity/i);
  });
});