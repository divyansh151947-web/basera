import { describe, expect, it, vi, beforeEach, beforeAll, afterEach, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, leads, organizations, voiceSessions } from "@/db/schema";
import {
  KokoroVoiceProvider,
  kokoroIsConfigured,
  resolveKokoroVoice,
} from "./kokoro-voice-provider";
import { isVoiceLanguage } from "./voice-provider";
import { startVoiceSession } from "./voice-session";

const ORG = "kokoro-test-org";

const SAVED = {
  provider: process.env.VOICE_PROVIDER,
  base: process.env.KOKORO_BASE_URL,
  key: process.env.KOKORO_API_KEY,
  voice: process.env.KOKORO_VOICE,
  openaiKey: process.env.OPENAI_API_KEY,
};

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

function resetVoiceEnv() {
  delete process.env.VOICE_PROVIDER;
  delete process.env.KOKORO_BASE_URL;
  delete process.env.KOKORO_API_KEY;
  delete process.env.KOKORO_VOICE;
  delete process.env.OPENAI_API_KEY;
}

function restoreVoiceEnv() {
  vi.unstubAllGlobals();
  if (SAVED.provider === undefined) delete process.env.VOICE_PROVIDER;
  else process.env.VOICE_PROVIDER = SAVED.provider;
  if (SAVED.base === undefined) delete process.env.KOKORO_BASE_URL;
  else process.env.KOKORO_BASE_URL = SAVED.base;
  if (SAVED.key === undefined) delete process.env.KOKORO_API_KEY;
  else process.env.KOKORO_API_KEY = SAVED.key;
  if (SAVED.voice === undefined) delete process.env.KOKORO_VOICE;
  else process.env.KOKORO_VOICE = SAVED.voice;
  if (SAVED.openaiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = SAVED.openaiKey;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const mp3 = (extra = 0) => Buffer.from([0x49, 0x44, 0x33, ...Array(extra).fill(0x01)]);

async function wipeOrg() {
  await db.delete(voiceSessions).where(eq(voiceSessions.organizationId, ORG));
  await db.delete(conversations).where(eq(conversations.organizationId, ORG));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

beforeEach(() => {
  resetVoiceEnv();
  mockFetch();
});

afterEach(() => {
  restoreVoiceEnv();
});

describe("kokoro provider selection (mocked transport — no server, no network)", () => {
  beforeAll(async () => {
    await wipeOrg();
    await db.insert(organizations).values({ id: ORG, name: "Kokoro Test", slug: `kokoro-test-${Date.now()}` });
  });

  afterAll(wipeOrg);

  it("2. VOICE_PROVIDER=kokoro selects the Kokoro adapter", async () => {
    process.env.VOICE_PROVIDER = "kokoro";
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    const s = await startVoiceSession({ organizationId: ORG });
    expect(s.mock).toBe(false);
    const row = await db.select().from(voiceSessions).where(eq(voiceSessions.id, s.id));
    expect(row[0]?.providerId).toBe("kokoro");
  });

  it("1. VOICE_PROVIDER=openai still selects OpenAI (regression)", async () => {
    process.env.VOICE_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key-openai";
    const s = await startVoiceSession({ organizationId: ORG });
    const row = await db.select().from(voiceSessions).where(eq(voiceSessions.id, s.id));
    expect(row[0]?.providerId).toBe("openai");
    expect(s.mock).toBe(false);
  });

  it("4. unknown provider fails safely", async () => {
    process.env.VOICE_PROVIDER = "acme-voice";
    await expect(startVoiceSession({ organizationId: ORG })).rejects.toThrow(/not configured/i);
  });

  it("5. missing KOKORO_BASE_URL fails clearly (adapter + selection)", async () => {
    process.env.VOICE_PROVIDER = "kokoro";
    expect(kokoroIsConfigured()).toBe(false);
    await expect(startVoiceSession({ organizationId: ORG })).rejects.toThrow(/not configured/i);
    const provider = new KokoroVoiceProvider();
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /KOKORO_BASE_URL/
    );
  });
});

describe("kokoro synthesis (mocked HTTP)", () => {
  it("synthesizes via the configured self-hosted endpoint", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880/";
    handler = async (url, init) => {
      expect(url).toBe("http://kokoro.local:8880/v1/audio/speech");
      const body = JSON.parse(init.body as string) as { model: string; voice: string; input: string };
      expect(body.model).toBe("kokoro");
      expect(body.voice).toBe("af_sarah");
      expect(body.input).toBe("Hello!");
      return new Response(mp3(), { status: 200, headers: { "content-type": "audio/mpeg" } });
    };
    const provider = new KokoroVoiceProvider();
    const result = await provider.synthesizeReply({ replyText: "Hello!", language: "en", conversationId: "c" });
    expect(result.mock).toBe(false);
    expect(result.audioMimeType).toBe("audio/mpeg");
    expect(result.audioBase64).toBe(mp3().toString("base64"));
    // Latency/size telemetry recorded on the result (not log spam).
    expect(typeof result.providerMetadata["requestMs"]).toBe("number");
    expect(result.providerMetadata["responseBytes"]).toBe(3);
    expect(result.providerMetadata["voice"]).toBe("af_sarah");
  });

  it("sends the API key ONLY in the Authorization header when set", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    process.env.KOKORO_API_KEY = "kokoro-secret-1";
    handler = async (_url, init) => {
      const headers = init.headers as Record<string, string>;
      expect(headers["authorization"]).toBe("Bearer kokoro-secret-1");
      expect(JSON.stringify(init.body)).not.toContain("kokoro-secret-1");
      return new Response(mp3(), { status: 200 });
    };
    const provider = new KokoroVoiceProvider();
    await provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" });
  });

  it("omits Authorization entirely for keyless self-hosted servers", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    handler = async (_url, init) => {
      const headers = init.headers as Record<string, string>;
      expect(headers["authorization"]).toBeUndefined();
      return new Response(mp3(), { status: 200 });
    };
    const provider = new KokoroVoiceProvider();
    await provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" });
  });

  it("6/7. unreachable server fails clearly with NO OpenAI fallback", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    process.env.OPENAI_API_KEY = "openai-key-present-but-unused";
    handler = async () => {
      throw new TypeError("fetch failed");
    };
    const provider = new KokoroVoiceProvider();
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /could not be reached/i
    );
    expect(calls.every((c) => !c.url.includes("api.openai.com"))).toBe(true);
  });

  it("HTTP errors map to safe statuses (401/429/500)", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    const provider = new KokoroVoiceProvider();
    handler = () => jsonResponse({ error: "denied" }, 401);
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /not authorized/i
    );
    handler = () => jsonResponse({ error: "busy" }, 429);
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /rate-limited/i
    );
    handler = () => jsonResponse({ error: "boom" }, 500);
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /failed/i
    );
  });

  it("12. secrets never appear in results, errors, or metadata", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    process.env.KOKORO_API_KEY = "kokoro-canary-777";
    process.env.OPENAI_API_KEY = "openai-canary-888";
    handler = () => jsonResponse({ error: "nope" }, 500);
    const provider = new KokoroVoiceProvider();
    let caught: unknown = null;
    try {
      await provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const json = JSON.stringify((caught as Error).message);
    expect(json).not.toContain("kokoro-canary-777");
    expect(json).not.toContain("openai-canary-888");
    expect(JSON.stringify(provider)).not.toContain("canary");
  });
});

describe("kokoro languages (honest allowlist, no silent remapping)", () => {
  it("9. language parameter selects the documented voice per language", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    const seen: Record<string, string> = {};
    handler = async (_url, init) => {
      const body = JSON.parse(init.body as string) as { voice: string; input: string };
      seen[body.input] = body.voice;
      return new Response(mp3(), { status: 200 });
    };
    const provider = new KokoroVoiceProvider();
    await provider.synthesizeReply({ replyText: "one", language: "en", conversationId: "c" });
    await provider.synthesizeReply({ replyText: "two", language: "hi", conversationId: "c" });
    await provider.synthesizeReply({ replyText: "three", language: "hinglish", conversationId: "c" });
    await provider.synthesizeReply({ replyText: "four", language: "es", conversationId: "c" });
    expect(seen).toEqual({ one: "af_sarah", two: "hf_alpha", three: "hf_alpha", four: "ef_dora" });
  });

  it("10. Marathi, Rajasthani, and unknown codes fail explicitly", async () => {
    // Not in the provider contract at all: rejected before any work.
    expect(isVoiceLanguage("mr")).toBe(true); // explicit code, explicit rejection
    expect(isVoiceLanguage("xx")).toBe(false);
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    const provider = new KokoroVoiceProvider();
    // Marathi: unsupported with a best-candidate note (never silent Hindi).
    await expect(
      provider.synthesizeReply({ replyText: "hi", language: "mr", conversationId: "c" })
    ).rejects.toThrow(/not supported.*indic-parler-tts/i);
    await expect(
      provider.prepareTurn({ transcriptText: "hi", language: "mr", conversationId: "c", leadId: "l" })
    ).rejects.toThrow(/not supported/i);
    // Rajasthani: experimental wording, never a quiet Hindi substitution.
    await expect(
      provider.synthesizeReply({ replyText: "hi", language: "rajasthani", conversationId: "c" })
    ).rejects.toThrow(/experimental/i);
    // Unknown codes: rejected, never remapped.
    await expect(
      provider.synthesizeReply({ replyText: "hi", language: "xx" as never, conversationId: "c" })
    ).rejects.toThrow(/not supported/i);
    // Hindi is Hindi — never silently substituted for the above.
    expect(resolveKokoroVoice("hi", null)).toBe("hf_alpha");
    expect(calls).toHaveLength(0);
  });

  it("10b. every unsupported Indian language fails in both methods without network", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    const provider = new KokoroVoiceProvider();
    const unsupported = ["bn", "gu", "pa", "ta", "te", "kn", "ml", "or", "as", "ur"] as const;
    for (const lang of unsupported) {
      await expect(provider.synthesizeReply({ replyText: "hi", language: lang, conversationId: "c" })).rejects.toThrow(
        /not supported/i
      );
      await expect(
        provider.prepareTurn({ transcriptText: "hi", language: lang, conversationId: "c", leadId: "l" })
      ).rejects.toThrow(/not supported/i);
    }
    expect(calls).toHaveLength(0);
  });

  it("explicit KOKORO_VOICE override is validated against known IDs", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    process.env.KOKORO_VOICE = "not-a-voice";
    const provider = new KokoroVoiceProvider();
    await expect(provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" })).rejects.toThrow(
      /not a known Kokoro voice/i
    );
    expect(calls).toHaveLength(0);
    process.env.KOKORO_VOICE = "bm_george";
    handler = async (_url, init) => {
      const body = JSON.parse(init.body as string) as { voice: string };
      expect(body.voice).toBe("bm_george");
      return new Response(mp3(), { status: 200 });
    };
    const result = await provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" });
    expect(result.audioBase64).toBe(mp3().toString("base64"));
  });
});

describe("kokoro turns (typed transcripts through the same pipeline)", () => {
  it("prepareTurn passes text through; audio is honestly rejected", async () => {
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    const provider = new KokoroVoiceProvider();
    const ok = await provider.prepareTurn({
      transcriptText: "  hello  ",
      language: "es",
      conversationId: "c",
      leadId: "l",
    });
    expect(ok.mock).toBe(false);
    expect(ok.transcriptText).toBe("hello");
    expect(ok.language).toBe("es");
    await expect(
      provider.prepareTurn({
        transcriptText: "",
        language: "en",
        conversationId: "c",
        leadId: "l",
        audioBase64: Buffer.from("x").toString("base64"),
      })
    ).rejects.toThrow(/speech output only/i);
    expect(calls).toHaveLength(0);
  });
});
