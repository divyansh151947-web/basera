import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import {
  conversations,
  leads,
  messages,
  organizations,
  users,
  voiceSessions,
} from "@/db/schema";
import {
  endVoiceSession,
  getVoiceSessionOrThrow,
  startVoiceSession,
  voiceTurn,
} from "./voice-session";
import { getVoiceProviderName } from "./voice-provider";
import { MockVoiceProvider } from "./mock-voice-provider";

const ORG = "voice-test-org";
const OTHER_ORG = "voice-other-org";

async function wipe() {
  await db.delete(voiceSessions).where(eq(voiceSessions.organizationId, ORG));
  await db.delete(voiceSessions).where(eq(voiceSessions.organizationId, OTHER_ORG));
  await db.delete(messages).where(eq(messages.conversationId, "voice-convo-web"));
  await db.delete(conversations).where(eq(conversations.organizationId, ORG));
  await db.delete(conversations).where(eq(conversations.organizationId, OTHER_ORG));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(leads).where(eq(leads.organizationId, OTHER_ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, OTHER_ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
  await db.delete(organizations).where(eq(organizations.id, OTHER_ORG));
}

describe("voice sessions (Phase 1 foundation)", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values([
      { id: ORG, name: "Voice Test", slug: `voice-test-${Date.now()}` },
      { id: OTHER_ORG, name: "Voice Other", slug: `voice-other-${Date.now()}` },
    ]);
    const pw = await bcrypt.hash("x", 4);
    await db.insert(users).values({
      id: "voice-manager", organizationId: ORG, name: "Voice Manager",
      email: "voice-manager@example.com", passwordHash: pw, role: "MANAGER",
    });
    // Existing website lead + thread for continuity tests.
    await db.insert(leads).values({
      id: "voice-web-lead", organizationId: ORG, name: "Web Visitor",
      source: "WEBSITE_CHAT", score: 10, temperature: "COLD", status: "NEW",
    });
    await db.insert(conversations).values({
      id: "voice-convo-web", organizationId: ORG, leadId: "voice-web-lead",
      channel: "WEBSITE_CHAT", status: "AI_HANDLING",
    });
    await db.insert(leads).values({
      id: "voice-foreign-lead", organizationId: OTHER_ORG, source: "MANUAL",
    });
  });

  afterAll(wipe);

  it("1. session creation yields lead + VOICE conversation", async () => {
    const s = await startVoiceSession({ organizationId: ORG });
    expect(s.id.startsWith("vs_")).toBe(true);
    expect(s.status).toBe("ACTIVE");
    expect(s.mock).toBe(true);
    const convRows = await db.select().from(conversations).where(eq(conversations.id, s.conversationId));
    expect(convRows[0]?.channel).toBe("VOICE");
    const leadRows = await db.select().from(leads).where(eq(leads.id, s.leadId));
    expect(leadRows[0]?.source).toBe("VOICE");
    // Session bookkeeping is durable (survives beyond the creating call).
    const reread = await getVoiceSessionOrThrow(s.id);
    expect(reread.status).toBe("ACTIVE");
  });

  it("2. cross-tenant references and mismatched bindings are rejected", async () => {
    await expect(startVoiceSession({ organizationId: ORG, leadId: "voice-foreign-lead" })).rejects.toThrow();
    await expect(
      startVoiceSession({ organizationId: ORG, leadId: "voice-web-lead", conversationId: "voice-convo-web".replace("web", "nope") })
    ).rejects.toThrow();
    // Conversation from another org is invisible (tenant-scoped read).
    await expect(startVoiceSession({ organizationId: OTHER_ORG, conversationId: "voice-convo-web" })).rejects.toThrow();
  });

  it("3/7. voice channel identified; existing lead/thread reused (continuity)", async () => {
    const s = await startVoiceSession({ organizationId: ORG, leadId: "voice-web-lead" });
    // Lead-scoped start creates a VOICE thread for the same lead.
    expect(s.leadId).toBe("voice-web-lead");
    const thread = await startVoiceSession({ organizationId: ORG, conversationId: "voice-convo-web" });
    // Explicit thread attach continues the ORIGINAL thread, channel intact.
    expect(thread.conversationId).toBe("voice-convo-web");
    expect(thread.conversationChannel).toBe("WEBSITE_CHAT");
    expect(thread.leadId).toBe("voice-web-lead");
  });

  it("4. lifecycle: turn increments, end closes, closed sessions reject turns", async () => {
    const s = await startVoiceSession({ organizationId: ORG, language: "hinglish" });
    expect(s.language).toBe("hinglish");
    const t1 = await voiceTurn({ sessionId: s.id, transcriptText: "Hi, mujhe Gurgaon mein 3 BHK chahiye." });
    expect(t1.turns).toBe(1);
    expect(typeof t1.reply).toBe("string");
    expect(t1.reply.length).toBeGreaterThan(0);
    expect(t1.mock).toBe(true);
    const t2 = await voiceTurn({ sessionId: s.id, transcriptText: "Budget around 1.5 crore." });
    expect(t2.turns).toBe(2);
    // Structured data landed on the SAME lead via the existing pipeline.
    const leadRows = await db.select().from(leads).where(eq(leads.id, s.leadId));
    expect(leadRows[0]?.preferredCity).toBe("Gurgaon");
    expect(leadRows[0]?.bhk).toBe(3);
    expect(leadRows[0]?.budgetMaxInr).toBe(15_000_000);
    const summary = await endVoiceSession(s.id);
    expect(summary.status).toBe("ENDED");
    expect(summary.turns).toBe(2);
    expect(summary.outcome).toMatch(/Ended after 2 turns/);
    await expect(voiceTurn({ sessionId: s.id, transcriptText: "hello?" })).rejects.toThrow(/ended/i);
    // Ending twice is safe (idempotent close).
    const summary2 = await endVoiceSession(s.id);
    expect(summary2.status).toBe("ENDED");
  });

  it("8. language tags pass through; invalid tags default safely", async () => {
    const s = await startVoiceSession({ organizationId: ORG, language: "hi" });
    expect(s.language).toBe("hi");
    const bad = await startVoiceSession({ organizationId: ORG, language: "xx" });
    expect(bad.language).toBe("en");
  });

  it("9/10. invalid sessions and bad input are rejected with safe errors", async () => {
    await expect(voiceTurn({ sessionId: "vs_does-not-exist", transcriptText: "hi" })).rejects.toThrow(/not found/i);
    await expect(endVoiceSession("vs_does-not-exist")).rejects.toThrow(/not found/i);
    await expect(getVoiceSessionOrThrow("vs_does-not-exist")).rejects.toThrow(/not found/i);
    const s = await startVoiceSession({ organizationId: ORG });
    await expect(voiceTurn({ sessionId: s.id, transcriptText: "   " })).rejects.toThrow();
    await expect(startVoiceSession({ organizationId: ORG, leadId: "lead-that-does-not-exist" })).rejects.toThrow();
  });

  it("8b. session objects and provider metadata carry no secrets", async () => {
    const s = await startVoiceSession({ organizationId: ORG });
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/api[_-]?key|secret|token|password|bearer/i);
    const provider = new MockVoiceProvider();
    const prepared = await provider.prepareTurn({
      transcriptText: "hello", language: "en", conversationId: s.conversationId, leadId: s.leadId,
    });
    expect(JSON.stringify(prepared)).not.toMatch(/api[_-]?key|secret|token|password|bearer/i);
  });
});

describe("provider abstraction", () => {
  it("5. factory defaults to mock; unknown providers fail closed", () => {
    expect(getVoiceProviderName({})).toBe("mock");
    expect(getVoiceProviderName({ VOICE_PROVIDER: "" })).toBe("mock");
    expect(getVoiceProviderName({ VOICE_PROVIDER: "  MOCK " })).toBe("mock");
    expect(getVoiceProviderName({ VOICE_PROVIDER: "live-vendor" })).toBe("live-vendor");
  });

  it("5b. requesting a live provider fails closed (no silent mocking)", async () => {
    const saved = process.env.VOICE_PROVIDER;
    process.env.VOICE_PROVIDER = "acme-realtime";
    try {
      await expect(startVoiceSession({ organizationId: ORG })).rejects.toThrow(/not configured/i);
    } finally {
      if (saved === undefined) delete process.env.VOICE_PROVIDER;
      else process.env.VOICE_PROVIDER = saved;
    }
  });

  it("6. mock provider is honest about doing no audio work", async () => {
    const provider = new MockVoiceProvider();
    expect(provider.mode).toBe("mock");
    const prepared = await provider.prepareTurn({
      transcriptText: "  hello  ", language: "hinglish", conversationId: "c", leadId: "l",
    });
    expect(prepared.mock).toBe(true);
    expect(prepared.transcriptText).toBe("hello");
    expect(prepared.processingNote).toMatch(/no audio/i);
    const synth = await provider.synthesizeReply({ replyText: "hi", language: "en", conversationId: "c" });
    expect(synth.audioBase64).toBeNull();
    expect(synth.mock).toBe(true);
    await expect(
      provider.prepareTurn({ transcriptText: "   ", language: "en", conversationId: "c", leadId: "l" })
    ).rejects.toThrow();
  });
});

describe("Phase 1 boundaries (freeze guards)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = resolve(here, "..", "..");

  it("no telephony providers anywhere in the codebase", () => {
    const hits: string[] = [];
    const pattern = /\b(twilio|exotel|plivo|telnyx|vonage)\b/i;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
          walk(full);
        } else if (/\.(ts|tsx|js|mjs|json)$/.test(entry) && !entry.endsWith(".test.ts")) {
          const content = readFileSync(full, "utf8");
          // Allow this very test file's own mention via pattern exclusion:
          // (test files are skipped above; this assertion names the vendors
          // only in comments, which we strip before matching.)
          const stripped = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
          if (pattern.test(stripped)) hits.push(full.split(sep).slice(-3).join("/"));
        }
      }
    };
    walk(srcRoot);
    expect(hits).toEqual([]);
  });

  it("no telephony dependency added to package.json", async () => {
    const pkg = JSON.parse(readFileSync(resolve(here, "..", "..", "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    for (const name of Object.keys(pkg.dependencies)) {
      expect(name).not.toMatch(/twilio|exotel|plivo|telnyx|vonage|sip/i);
    }
  });

  it("voice server code never touches provider secrets", () => {
    const liveAdapters = ["openai-voice-provider.ts", "kokoro-voice-provider.ts"];
    for (const file of ["voice-provider.ts", "mock-voice-provider.ts", "voice-session.ts", "voice-languages.ts", ...liveAdapters]) {
      const src = readFileSync(resolve(here, file), "utf8");
      expect(src).not.toMatch(/APP_SECRET|ACCESS_TOKEN|NEXT_PUBLIC_/);
      // Live adapters read ONLY their own server-side key for the
      // Authorization header (asserted header-only by adapter tests).
      if (!liveAdapters.includes(file)) {
        expect(src).not.toMatch(/OPENAI_API_KEY|KOKORO_API_KEY/);
      } else {
        expect(src).toMatch(/authorization/);
      }
    }
  });
});

describe("Phase 2 live integration (mocked transport — no credentials, no network)", () => {
  const LIVE_ORG = "voice-live-org";
  const savedProvider = process.env.VOICE_PROVIDER;
  const savedKey = process.env.OPENAI_API_KEY;

  // Self-contained fixtures: this suite must pass regardless of file order
  // or -t filtering (the earlier suite wipes its own orgs on completion).
  beforeAll(async () => {
    await db.delete(leads).where(eq(leads.organizationId, LIVE_ORG));
    await db.delete(users).where(eq(users.organizationId, LIVE_ORG));
    await db.delete(organizations).where(eq(organizations.id, LIVE_ORG));
    await db.insert(organizations).values({ id: LIVE_ORG, name: "Voice Live", slug: `voice-live-${Date.now()}` });
    const pw = await bcrypt.hash("x", 4);
    await db.insert(users).values({
      id: "voice-live-manager", organizationId: LIVE_ORG, name: "Voice Live Manager",
      email: "voice-live-manager@example.com", passwordHash: pw, role: "MANAGER",
    });
  });

  afterAll(async () => {
    const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.organizationId, LIVE_ORG));
    for (const c of convs) {
      await db.delete(messages).where(eq(messages.conversationId, c.id));
    }
    await db.delete(conversations).where(eq(conversations.organizationId, LIVE_ORG));
    await db.delete(leads).where(eq(leads.organizationId, LIVE_ORG));
    await db.delete(users).where(eq(users.organizationId, LIVE_ORG));
    await db.delete(organizations).where(eq(organizations.id, LIVE_ORG));
  });

  function useLive() {
    process.env.VOICE_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key-live";
    const calls: { url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url });
        if (url.endsWith("/audio/transcriptions")) {
          return new Response(JSON.stringify({ text: "Budget around 1.5 crore.", language: "en" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/audio/speech")) {
          return new Response(Buffer.from([0x49, 0x44, 0x33]), {
            status: 200,
            headers: { "content-type": "audio/mpeg" },
          });
        }
        // Chat completions: fail so the pipeline takes its HONEST
        // deterministic fallback (same as an unreachable LLM in production).
        // Never fake brain output.
        return new Response("{}", {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      })
    );
    return calls;
  }

  function restoreEnv() {
    vi.unstubAllGlobals();
    if (savedProvider === undefined) delete process.env.VOICE_PROVIDER;
    else process.env.VOICE_PROVIDER = savedProvider;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  }

  it("7/13. audio turn flows through the REAL Basera pipeline with audio out", async () => {
    const calls = useLive();
    try {
      const s = await startVoiceSession({ organizationId: LIVE_ORG });
      expect(s.mock).toBe(false);
      const result = await voiceTurn({
        sessionId: s.id,
        transcriptText: "",
        audioBase64: Buffer.from("fake-mic-bytes").toString("base64"),
        audioMimeType: "audio/webm",
      });
      // Transcript came from (mocked) STT, reply from the real pipeline.
      expect(result.mock).toBe(false);
      expect(typeof result.reply).toBe("string");
      expect(result.reply.length).toBeGreaterThan(0);
      expect(result.replyAudioBase64).toBe(Buffer.from([0x49, 0x44, 0x33]).toString("base64"));
      expect(result.replyAudioMimeType).toBe("audio/mpeg");
      expect(calls.map((c) => c.url)).toContain("https://api.openai.com/v1/audio/transcriptions");
      expect(calls.map((c) => c.url)).toContain("https://api.openai.com/v1/audio/speech");
      // Same lead updated by the existing pipeline — continuity preserved.
      const leadRows = await db.select().from(leads).where(eq(leads.id, s.leadId));
      expect(leadRows[0]?.budgetMaxInr).toBe(15_000_000);
      const thread = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, s.conversationId));
      expect(thread.some((m) => m.sender === "LEAD" && m.content === "Budget around 1.5 crore.")).toBe(true);
      await endVoiceSession(s.id);
    } finally {
      restoreEnv();
    }
  });

  it("7b. TTS failure still returns the transcript + reply text (browser fallback speaks it)", async () => {
    process.env.VOICE_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key-live";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/audio/transcriptions")) {
          return new Response(JSON.stringify({ text: "Hello", language: "en" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/audio/speech")) {
          return new Response(JSON.stringify({ error: "throttled" }), {
            status: 429,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 500, headers: { "content-type": "application/json" } });
      })
    );
    try {
      const s = await startVoiceSession({ organizationId: LIVE_ORG });
      const result = await voiceTurn({
        sessionId: s.id,
        transcriptText: "",
        audioBase64: Buffer.from("fake-mic-bytes").toString("base64"),
        audioMimeType: "audio/webm",
      });
      // Chat is intact: transcript + exact reply text present, no audio, miss recorded.
      expect(result.transcriptText).toBe("Hello");
      expect(typeof result.reply).toBe("string");
      expect(result.reply.length).toBeGreaterThan(0);
      expect(result.replyAudioBase64).toBeNull();
      expect(result.replyAudioMimeType).toBeNull();
      expect(result.providerMetadata).toMatchObject({ ttsMissed: true });
      const thread = await db.select().from(messages).where(eq(messages.conversationId, s.conversationId));
      expect(thread.some((m) => m.sender === "LEAD" && m.content === "Hello")).toBe(true);
      expect(thread.some((m) => m.sender === "AI" && m.content === result.reply)).toBe(true);
      await endVoiceSession(s.id);
    } finally {
      restoreEnv();
    }
  });

  it("14. mock mode still works when live is not selected", async () => {    delete process.env.VOICE_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    try {
      const s = await startVoiceSession({ organizationId: LIVE_ORG });
      expect(s.mock).toBe(true);
      const result = await voiceTurn({ sessionId: s.id, transcriptText: "Hello" });
      expect(result.mock).toBe(true);
      expect(result.replyAudioBase64).toBeNull();
      await endVoiceSession(s.id);
    } finally {
      restoreEnv();
    }
  });

  it("mock provider honestly rejects audio input", async () => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: LIVE_ORG });
      await expect(
        voiceTurn({ sessionId: s.id, transcriptText: "", audioBase64: Buffer.from("x").toString("base64") })
      ).rejects.toThrow(/cannot process audio/i);
      await endVoiceSession(s.id);
    } finally {
      restoreEnv();
    }
  });
});

describe("conversational loop: isolation + multilingual + general questions", () => {
  // Own fixtures: this suite must not depend on other describes' orgs
  // (their afterAll wipes run first).
  const LOOP_ORG = "voice-loop-org";
  const savedProvider = process.env.VOICE_PROVIDER;
  const savedKey = process.env.OPENAI_API_KEY;
  const savedKokoroBase = process.env.KOKORO_BASE_URL;

  beforeAll(async () => {
    await db.delete(leads).where(eq(leads.organizationId, LOOP_ORG));
    await db.delete(users).where(eq(users.organizationId, LOOP_ORG));
    await db.delete(organizations).where(eq(organizations.id, LOOP_ORG));
    await db.insert(organizations).values({ id: LOOP_ORG, name: "Voice Loop", slug: `voice-loop-${Date.now()}` });
  });

  afterAll(async () => {
    const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.organizationId, LOOP_ORG));
    for (const c of convs) {
      await db.delete(messages).where(eq(messages.conversationId, c.id));
    }
    await db.delete(conversations).where(eq(conversations.organizationId, LOOP_ORG));
    await db.delete(leads).where(eq(leads.organizationId, LOOP_ORG));
    await db.delete(users).where(eq(users.organizationId, LOOP_ORG));
    await db.delete(organizations).where(eq(organizations.id, LOOP_ORG));
  });

  function restoreEnv() {
    vi.unstubAllGlobals();
    if (savedProvider === undefined) delete process.env.VOICE_PROVIDER;
    else process.env.VOICE_PROVIDER = savedProvider;
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
    if (savedKokoroBase === undefined) delete process.env.KOKORO_BASE_URL;
    else process.env.KOKORO_BASE_URL = savedKokoroBase;
  }

  function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url });
        return handler(url, init);
      })
    );
    return calls;
  }

  const mp3 = () =>
    new Response(Buffer.from([0x49, 0x44, 0x33]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  const fail = () => new Response("{}", { status: 500, headers: { "content-type": "application/json" } });

  it("12. kokoro turn never uses OpenAI for VOICE AUDIO even with an OpenAI key present", async () => {
    process.env.VOICE_PROVIDER = "kokoro";
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    process.env.OPENAI_API_KEY = "openai-key-present-but-unused";
    const mp3bytes = Buffer.from([0x49, 0x44, 0x33]);
    const calls = stubFetch(async (url) => {
      if (url.endsWith("/v1/audio/speech")) return mp3();
      return fail();
    });
    try {
      const s = await startVoiceSession({ organizationId: LOOP_ORG });
      expect(s.mock).toBe(false);
      const result = await voiceTurn({ sessionId: s.id, transcriptText: "Hello kokoro" });
      expect(result.mock).toBe(false);
      // The reply AUDIO provably came from Kokoro, not OpenAI TTS/STT.
      expect(result.replyAudioBase64).toBe(mp3bytes.toString("base64"));
      const audioUrls = calls.map((c) => c.url).filter((u) => u.includes("/audio/"));
      expect(audioUrls).toHaveLength(1);
      expect(audioUrls[0]).toContain("kokoro.local");
      // Chat-completions calls (if any) belong to the shared Basera brain,
      // which uses the explicitly configured LLM identically on every
      // channel — never a voice-layer vendor switch.
      await endVoiceSession(s.id);
    } finally {
      restoreEnv();
    }
  });

  it("13. openai turn never calls the Kokoro server", async () => {
    process.env.VOICE_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key-openai";
    process.env.KOKORO_BASE_URL = "http://kokoro.local:8880";
    const calls = stubFetch(async (url) => {
      if (url.endsWith("/audio/transcriptions")) {
        return new Response(JSON.stringify({ text: "Hello openai", language: "en" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/audio/speech")) return mp3();
      return fail();
    });
    try {
      const s = await startVoiceSession({ organizationId: LOOP_ORG });
      const result = await voiceTurn({
        sessionId: s.id,
        transcriptText: "",
        audioBase64: Buffer.from("fake-mic").toString("base64"),
      });
      expect(result.mock).toBe(false);
      expect(result.replyAudioBase64).not.toBeNull();
      expect(calls.some((c) => c.url.includes("kokoro.local"))).toBe(false);
      expect(calls.some((c) => c.url.includes("api.openai.com"))).toBe(true);
      await endVoiceSession(s.id);
    } finally {
      restoreEnv();
    }
  });

  it.each([
    ["14. english input path", "I need a three bedroom apartment in Gurgaon."],
    ["15. hindi input path", "जयपुर में झोटवाड़ा कहाँ है?"],
    ["16. hinglish input path", "Jaipur mein Jhotwara ke paas property chahiye."],
    ["17. general question path", "What is BHK?"],
  ])("%s completes without rejection and records the transcript", async (_label, text) => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: LOOP_ORG });
      const result = await voiceTurn({ sessionId: s.id, transcriptText: text });
      expect(typeof result.reply).toBe("string");
      expect(result.reply.length).toBeGreaterThan(0);
      const thread = await db.select().from(messages).where(eq(messages.conversationId, s.conversationId));
      expect(thread.some((m) => m.sender === "LEAD" && m.content === text)).toBe(true);
      await endVoiceSession(s.id);
    } finally {
      restoreEnv();
    }
  });

  it("18. real-estate qualification path still extracts through voice turns", async () => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: LOOP_ORG });
      await voiceTurn({ sessionId: s.id, transcriptText: "मुझे जयपुर में झोटवाड़ा में 3 BHK चाहिए।" });
      const leadRows = await db.select().from(leads).where(eq(leads.id, s.leadId));
      // Deterministic extractor behavior is asserted as-is (no invention):
      // BHK numeral extraction works across scripts; city match is reported.
      expect(leadRows[0]?.bhk).toBe(3);
      await endVoiceSession(s.id);
    } finally {
      restoreEnv();
    }
  });

  it("language switch persists on the session and selects synthesis voice", async () => {
    delete process.env.VOICE_PROVIDER;
    const { getVoiceSessionOrThrow } = await import("./voice-session");
    try {
      const s = await startVoiceSession({ organizationId: LOOP_ORG });
      const switched = await voiceTurn({ sessionId: s.id, transcriptText: "Hindi mein baat karo." });
      expect(switched.language).toBe("hi");
      expect((await getVoiceSessionOrThrow(s.id)).language).toBe("hi");
      // A later neutral turn inherits the persisted preference.
      const next = await voiceTurn({ sessionId: s.id, transcriptText: "Achha, aur batao." });
      expect(next.language).toBe("hi");
      // ...and it switches back just as explicitly.
      const back = await voiceTurn({ sessionId: s.id, transcriptText: "Speak in English please." });
      expect(back.language).toBe("en");
      expect((await getVoiceSessionOrThrow(s.id)).language).toBe("en");
      await endVoiceSession(s.id);
    } finally {
      restoreEnv();
    }
  });
});

describe("voice navigation actions (safe allowlist, same pipeline)", () => {
  const NAV_ORG = "voice-nav-org";
  const savedProvider = process.env.VOICE_PROVIDER;

  function restoreNavEnv() {
    if (savedProvider === undefined) delete process.env.VOICE_PROVIDER;
    else process.env.VOICE_PROVIDER = savedProvider;
  }

  beforeAll(async () => {
    await db.delete(leads).where(eq(leads.organizationId, NAV_ORG));
    await db.delete(users).where(eq(users.organizationId, NAV_ORG));
    await db.delete(organizations).where(eq(organizations.id, NAV_ORG));
    await db.insert(organizations).values({ id: NAV_ORG, name: "Voice Nav", slug: `voice-nav-${Date.now()}` });
  });

  afterAll(async () => {
    const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.organizationId, NAV_ORG));
    for (const c of convs) {
      await db.delete(messages).where(eq(messages.conversationId, c.id));
    }
    await db.delete(conversations).where(eq(conversations.organizationId, NAV_ORG));
    await db.delete(leads).where(eq(leads.organizationId, NAV_ORG));
    await db.delete(users).where(eq(users.organizationId, NAV_ORG));
    await db.delete(organizations).where(eq(organizations.id, NAV_ORG));
  });

  it("app navigation returns a fixed-allowlist action plus a spoken confirmation", async () => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: NAV_ORG });
      const result = await voiceTurn({ sessionId: s.id, transcriptText: "Open recovery." });
      expect(result.voiceAction).toEqual({
        kind: "navigate", action: "recovery", to: "/recovery", section: "Revenue Recovery",
      });
      expect(result.reply).toContain("Opening Revenue Recovery.");
      await endVoiceSession(s.id);
    } finally {
      restoreNavEnv();
    }
  });

  it("Hindi navigation auto-detects language and confirms in Hindi", async () => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: NAV_ORG });
      const result = await voiceTurn({ sessionId: s.id, transcriptText: "बाथरूम दिखाओ" });
      expect(result.language).toBe("hi");
      expect(result.voiceAction).toMatchObject({ kind: "tour", target: "bathroom" });
      expect(result.reply).toContain("dikha raha hoon");
      const reread = await getVoiceSessionOrThrow(s.id);
      expect(reread.language).toBe("hi");
      await endVoiceSession(s.id);
    } finally {
      restoreNavEnv();
    }
  });

  it("tour and property-search commands stay separated", async () => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: NAV_ORG });
      const tour = await voiceTurn({ sessionId: s.id, transcriptText: "Show me the pool." });
      expect(tour.voiceAction).toMatchObject({ kind: "tour", target: "pool" });
      const search = await voiceTurn({ sessionId: s.id, transcriptText: "Show me 3 BHK properties." });
      expect(search.voiceAction).toBeNull();
      await endVoiceSession(s.id);
    } finally {
      restoreNavEnv();
    }
  });

  it("data questions append a grounded line from real engines", async () => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: NAV_ORG });
      const result = await voiceTurn({ sessionId: s.id, transcriptText: "What is my revenue at risk?" });
      expect(result.voiceAction).toBeNull();
      expect(result.reply).toMatch(/at risk/i);
      await endVoiceSession(s.id);
    } finally {
      restoreNavEnv();
    }
  });

  it("ambiguous short answers never flip the session language", async () => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: NAV_ORG });
      const result = await voiceTurn({ sessionId: s.id, transcriptText: "Jaipur." });
      expect(result.language).toBe("en");
      expect((await getVoiceSessionOrThrow(s.id)).language).toBe("en");
      await endVoiceSession(s.id);
    } finally {
      restoreNavEnv();
    }
  });

  it("Hindi budget flow: Devanagari prompts, contextual budget understood", async () => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: NAV_ORG });
      const t1 = await voiceTurn({ sessionId: s.id, transcriptText: "Mujhe Gurgaon mein 3 BHK chahiye" });
      expect(t1.language).toBe("hi");
      expect(t1.reply).toMatch(/[ऀ-ॿ]/);
      const t2 = await voiceTurn({ sessionId: s.id, transcriptText: "80 lakh" });
      expect(t2.language).toBe("hi");
      expect(t2.reply).toMatch(/[ऀ-ॿ]/);
      expect(t2.reply).toContain("₹80 लाख");
      expect(t2.reply).not.toMatch(/didn't understand|didn’t quite catch|I didn’t quite catch/i);
      const leadRows = await db.select().from(leads).where(eq(leads.id, s.leadId));
      expect(leadRows[0]?.budgetMaxInr).toBe(8_000_000);
      await endVoiceSession(s.id);
    } finally {
      restoreNavEnv();
    }
  });

  it("Hindi BHK flow: bare '3' resolves to 3 BHK after a Hindi BHK prompt", async () => {
    delete process.env.VOICE_PROVIDER;
    try {
      const s = await startVoiceSession({ organizationId: NAV_ORG });
      const t1 = await voiceTurn({ sessionId: s.id, transcriptText: "Mujhe Gurgaon mein 80 lakh ke andar kuch chahiye" });
      expect(t1.language).toBe("hi");
      expect(t1.reply).toMatch(/[ऀ-ॿ]/);
      expect(t1.reply).toMatch(/BHK/);
      const t2 = await voiceTurn({ sessionId: s.id, transcriptText: "3" });
      expect(t2.reply).toMatch(/[ऀ-ॿ]/);
      expect(t2.reply).not.toMatch(/didn't understand|didn’t quite catch|I didn’t quite catch/i);
      const leadRows = await db.select().from(leads).where(eq(leads.id, s.leadId));
      expect(leadRows[0]?.bhk).toBe(3);
      await endVoiceSession(s.id);
    } finally {
      restoreNavEnv();
    }
  });
});
