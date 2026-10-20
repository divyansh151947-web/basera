import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OpenAIVoiceProvider,
  VOICE_MAX_AUDIO_BYTES,
  openAIVoiceIsConfigured,
  sttLanguageHint,
  ttsSupportsInstructions,
  validateTtsModel,
  validateTtsVoice,
} from "./openai-voice-provider";

const SAVED_KEY = process.env.OPENAI_API_KEY;

function setKey(value: string | undefined) {
  if (value === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = value;
}

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[];
let handler: ((url: string, init: RequestInit) => Response | Promise<Response>) | null;

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

beforeEach(() => {
  mockFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (SAVED_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = SAVED_KEY;
});

describe("openai voice provider (mocked transport — no credentials, no network)", () => {
  it("2/3. missing key fails closed before any network call", async () => {
    setKey(undefined);
    expect(openAIVoiceIsConfigured()).toBe(false);
    const provider = new OpenAIVoiceProvider();
    await expect(
      provider.prepareTurn({ transcriptText: "hi", language: "en", conversationId: "c", leadId: "l" })
    ).rejects.toThrow(/not configured/i);
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /not configured/i
    );
    expect(calls).toHaveLength(0);
  });

  it("transcribes audio and records detected-language metadata", async () => {
    setKey("test-key-abc");
    handler = (url) => {
      expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
      return jsonResponse({ text: "mujhe Gurgaon mein 3 BHK chahiye", language: "hi" });
    };
    const provider = new OpenAIVoiceProvider();
    const audio = Buffer.from("fake-audio-bytes").toString("base64");
    const result = await provider.prepareTurn({
      transcriptText: "",
      language: "hinglish",
      conversationId: "c",
      leadId: "l",
      audioBase64: audio,
      audioMimeType: "audio/webm",
    });
    expect(result.mock).toBe(false);
    expect(result.transcriptText).toBe("mujhe Gurgaon mein 3 BHK chahiye");
    expect(result.providerMetadata["detectedLanguage"]).toBe("hi");
    expect(result.processingNote).toMatch(/not stored/i);
    // Secret travels ONLY in the Authorization header.
    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer test-key-abc");
    expect(calls[0].url).not.toContain("test-key-abc");
  });

  it("4. invalid credentials surface a safe auth error (no body echo)", async () => {
    setKey("bad-key");
    handler = () => jsonResponse({ error: { message: "Incorrect API key provided: bad-key", type: "invalid_request" } }, 401);
    const provider = new OpenAIVoiceProvider();
    const audio = Buffer.from("x").toString("base64");
    await expect(
      provider.prepareTurn({ transcriptText: "", language: "en", conversationId: "c", leadId: "l", audioBase64: audio })
    ).rejects.toThrow(/not authorized/i);
    // The provider's echo of the bad key must never reach the caller.
    await expect(
      provider.prepareTurn({ transcriptText: "", language: "en", conversationId: "c", leadId: "l", audioBase64: audio }).catch((e: Error) => {
        expect(e.message).not.toContain("bad-key");
        throw e;
      })
    ).rejects.toThrow();
  });

  it("9. oversize audio is rejected before upload", async () => {
    setKey("test-key-abc");
    const provider = new OpenAIVoiceProvider();
    const big = Buffer.alloc(VOICE_MAX_AUDIO_BYTES + 1).toString("base64");
    await expect(
      provider.prepareTurn({ transcriptText: "", language: "en", conversationId: "c", leadId: "l", audioBase64: big })
    ).rejects.toThrow(/too long/i);
    expect(calls).toHaveLength(0);
  });

  it("synthesizes reply audio and returns base64 mp3", async () => {
    setKey("test-key-abc");
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x01, 0x02]);
    handler = async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/audio/speech");
      const body = JSON.parse(init.body as string) as { input: string; model: string };
      expect(body.input.length).toBeLessThanOrEqual(2000);
      expect(body.model).toBe("gpt-4o-mini-tts");
      return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
    };
    const provider = new OpenAIVoiceProvider();
    const result = await provider.synthesizeReply({ replyText: "Hello!", language: "en", conversationId: "c" });
    expect(result.mock).toBe(false);
    expect(result.audioMimeType).toBe("audio/mpeg");
    expect(result.audioBase64).toBe(mp3.toString("base64"));
  });

  it("8/10/16. provider errors and timeouts map to safe generic errors", async () => {
    setKey("test-key-abc");
    handler = () => jsonResponse({ error: "boom" }, 500);
    const provider = new OpenAIVoiceProvider();
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /failed/i
    );
    handler = () => jsonResponse({ error: "slow" }, 429);
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /rate-limited/i
    );
  });

  it("5. secret never appears in results, errors, or metadata", async () => {
    setKey("super-secret-key-999");
    handler = () => jsonResponse({ text: "hello", language: "en" });
    const provider = new OpenAIVoiceProvider();
    const audio = Buffer.from("x").toString("base64");
    const prepared = await provider.prepareTurn({
      transcriptText: "",
      language: "en",
      conversationId: "c",
      leadId: "l",
      audioBase64: audio,
    });
    expect(JSON.stringify(prepared)).not.toContain("super-secret-key-999");
    handler = () => jsonResponse({ error: "nope" }, 500);
    let caught: unknown = null;
    try {
      await provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("super-secret-key-999");
  });
});

describe("openai TTS invalid_request_error regression (instructions is model-gated)", () => {
  const SAVED_TTS_MODEL = process.env.VOICE_TTS_MODEL;
  const SAVED_TTS_VOICE = process.env.VOICE_TTS_VOICE;
  const SAVED_OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL;
  const SAVED_OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE;

  afterEach(() => {
    if (SAVED_TTS_MODEL === undefined) delete process.env.VOICE_TTS_MODEL;
    else process.env.VOICE_TTS_MODEL = SAVED_TTS_MODEL;
    if (SAVED_TTS_VOICE === undefined) delete process.env.VOICE_TTS_VOICE;
    else process.env.VOICE_TTS_VOICE = SAVED_TTS_VOICE;
    if (SAVED_OPENAI_TTS_MODEL === undefined) delete process.env.OPENAI_TTS_MODEL;
    else process.env.OPENAI_TTS_MODEL = SAVED_OPENAI_TTS_MODEL;
    if (SAVED_OPENAI_TTS_VOICE === undefined) delete process.env.OPENAI_TTS_VOICE;
    else process.env.OPENAI_TTS_VOICE = SAVED_OPENAI_TTS_VOICE;
  });

  it("ttsSupportsInstructions: gpt-4o TTS yes, tts-1/tts-1-hd no", () => {
    expect(ttsSupportsInstructions("gpt-4o-mini-tts")).toBe(true);
    expect(ttsSupportsInstructions("gpt-4o-mini-tts-2025-12-15")).toBe(true);
    expect(ttsSupportsInstructions("tts-1")).toBe(false);
    expect(ttsSupportsInstructions("tts-1-hd")).toBe(false);
  });

  it("REGRESSION: tts-1 + Hindi omits `instructions` (legacy models reject it with invalid_request_error)", async () => {
    setKey("test-key-abc");
    process.env.VOICE_TTS_MODEL = "tts-1";
    delete process.env.VOICE_TTS_VOICE;
    const mp3 = Buffer.from([0x49, 0x44, 0x33]);
    handler = async (_url, init) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body["model"]).toBe("tts-1");
      expect(body).not.toHaveProperty("instructions");
      expect(body["input"]).toContain("Namaste");
      return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
    };
    const provider = new OpenAIVoiceProvider();
    const result = await provider.synthesizeReply({ replyText: "Namaste! Jaipur mein 3 BHK.", language: "hi", conversationId: "c" });
    expect(result.mock).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("gpt-4o-mini-tts + Hindi KEEPS `instructions` (language routing preserved)", async () => {
    setKey("test-key-abc");
    delete process.env.VOICE_TTS_MODEL;
    delete process.env.OPENAI_TTS_MODEL;
    delete process.env.VOICE_TTS_VOICE;
    const mp3 = Buffer.from([0x49, 0x44, 0x33]);
    handler = async (_url, init) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body["model"]).toBe("gpt-4o-mini-tts");
      expect(typeof body["instructions"]).toBe("string");
      return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
    };
    const provider = new OpenAIVoiceProvider();
    await provider.synthesizeReply({ replyText: "Namaste!", language: "hi", conversationId: "c" });
    expect(calls).toHaveLength(1);
  });

  it("gpt-4o-mini-tts + English never sends `instructions` (exact legacy request)", async () => {
    setKey("test-key-abc");
    delete process.env.VOICE_TTS_MODEL;
    delete process.env.VOICE_TTS_VOICE;
    const mp3 = Buffer.from([0x49, 0x44, 0x33]);
    handler = async (_url, init) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).not.toHaveProperty("instructions");
      return new Response(mp3, { status: 200, headers: { "content-type": "audio/mpeg" } });
    };
    const provider = new OpenAIVoiceProvider();
    await provider.synthesizeReply({ replyText: "Hello, what can you help me with?", language: "en", conversationId: "c" });
    expect(calls).toHaveLength(1);
  });

  it("invalid TTS model (e.g. chat model in TTS slot) fails fast with a config error, no network", async () => {
    setKey("test-key-abc");
    process.env.VOICE_TTS_MODEL = "gpt-4o-mini";
    expect(() => validateTtsModel("gpt-4o-mini")).toThrow(/VOICE_TTS_MODEL/i);
    const provider = new OpenAIVoiceProvider();
    await expect(
      provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })
    ).rejects.toThrow(/VOICE_TTS_MODEL/i);
    expect(calls).toHaveLength(0);
  });

  it("Kokoro voice id in the OpenAI slot fails fast instead of a provider 400", async () => {
    setKey("test-key-abc");
    delete process.env.VOICE_TTS_MODEL;
    process.env.VOICE_TTS_VOICE = "hf_alpha";
    expect(() => validateTtsVoice("gpt-4o-mini-tts", "hf_alpha")).toThrow(/VOICE_TTS_VOICE/i);
    const provider = new OpenAIVoiceProvider();
    await expect(
      provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })
    ).rejects.toThrow(/VOICE_TTS_VOICE/i);
    expect(calls).toHaveLength(0);
  });

  it("STT: unsupported language codes are omitted (never sent as invalid Whisper `language`)", () => {
    expect(sttLanguageHint("hinglish")).toBe("hi");
    expect(sttLanguageHint("en")).toBe("en");
    expect(sttLanguageHint("hi")).toBe("hi");
    // "or" (Odia) has no Whisper ISO-639-1 slot: omit for auto-detect.
    expect(sttLanguageHint("or")).toBeNull();
    expect(sttLanguageHint("rajasthani")).toBeNull();
  });
});
