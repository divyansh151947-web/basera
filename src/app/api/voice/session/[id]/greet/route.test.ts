import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { conversations, leads, messages, organizations, voiceSessions } from "@/db/schema";
import { startVoiceSession } from "@/lib/voice/voice-session";
import { VOICE_GREETING_TEXT } from "@/lib/voice/voice-greeting";
import { POST } from "./route";

const ORG = "voice-greet-org";

async function wipe() {
  await db.delete(voiceSessions).where(eq(voiceSessions.organizationId, ORG));
  const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.organizationId, ORG));
  for (const c of convs) {
    await db.delete(messages).where(eq(messages.conversationId, c.id));
  }
  await db.delete(conversations).where(eq(conversations.organizationId, ORG));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

function post(id: string) {
  return POST(new NextRequest(`http://localhost/api/voice/session/${id}/greet`, { method: "POST" }), {
    params: { id },
  } as unknown as { params: { id: string } });
}

describe("POST /api/voice/session/[id]/greet", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values({ id: ORG, name: "Voice Greet", slug: `voice-greet-${Date.now()}` });
  });

  afterAll(wipe);

  it("unknown session → 404", async () => {
    expect((await post("vs_missing")).status).toBe(404);
  });

  it("first greet persists the exact greeting and returns it (mock audio null)", async () => {
    const s = await startVoiceSession({ organizationId: ORG });
    const res = await post(s.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.greeting).toBe(VOICE_GREETING_TEXT);
    expect(body.mock).toBe(true);
    expect(body.audioBase64).toBeNull();
    expect(body.alreadyGreeted).toBe(false);
    const rows = await db.select().from(messages).where(eq(messages.conversationId, s.conversationId));
    const greetings = rows.filter((m) => m.sender === "AI" && m.content === VOICE_GREETING_TEXT);
    expect(greetings).toHaveLength(1);
  });

  it("second greet does not duplicate the persisted message", async () => {
    const s = await startVoiceSession({ organizationId: ORG });
    expect((await post(s.id)).status).toBe(200);
    const again = await post(s.id);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { alreadyGreeted: boolean }).alreadyGreeted).toBe(true);
    const rows = await db.select().from(messages).where(eq(messages.conversationId, s.conversationId));
    expect(rows.filter((m) => m.sender === "AI" && m.content === VOICE_GREETING_TEXT)).toHaveLength(1);
  });

  it("ended session → 410", async () => {
    const s = await startVoiceSession({ organizationId: ORG });
    await db.update(voiceSessions).set({ status: "ENDED" }).where(eq(voiceSessions.id, s.id));
    expect((await post(s.id)).status).toBe(410);
  });
});
