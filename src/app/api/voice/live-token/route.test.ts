import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { conversations, leads, organizations, voiceSessions } from "@/db/schema";
import { startVoiceSession } from "@/lib/voice/voice-session";
import { POST } from "./route";

const ORG = "voice-live-token-org";

async function wipe() {
  await db.delete(voiceSessions).where(eq(voiceSessions.organizationId, ORG));
  const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.organizationId, ORG));
  for (const c of convs) {
    const { messages } = await import("@/db/schema");
    await db.delete(messages).where(eq(messages.conversationId, c.id));
  }
  await db.delete(conversations).where(eq(conversations.organizationId, ORG));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/voice/live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.98" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/voice/live-token (fail-closed, no key exposure)", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values({ id: ORG, name: "Voice Live Token", slug: `voice-live-token-${Date.now()}` });
  });

  afterAll(wipe);

  it("rejects missing sessionId", async () => {
    expect((await post({})).status).toBe(400);
  });

  it("rejects unknown sessions without touching the provider", async () => {
    expect((await post({ sessionId: "vs_missing" })).status).toBe(404);
  });

  it("never returns key material even when a session exists", async () => {
    const savedProvider = process.env.VOICE_PROVIDER;
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.VOICE_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key-should-never-leak";
    try {
      const s = await startVoiceSession({ organizationId: ORG });
      const res = await post({ sessionId: s.id });
      // Either a minted token (network) or a 503 provider failure — but the
      // response must NEVER contain the long-lived key in any form.
      const text = await res.text();
      expect(text).not.toContain("test-key-should-never-leak");
    } finally {
      if (savedProvider === undefined) delete process.env.VOICE_PROVIDER;
      else process.env.VOICE_PROVIDER = savedProvider;
      if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedKey;
    }
  });
});
