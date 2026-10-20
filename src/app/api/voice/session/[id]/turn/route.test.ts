import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { conversations, leads, messages, organizations, voiceSessions } from "@/db/schema";
import { startVoiceSession } from "@/lib/voice/voice-session";
import { mapVoiceTurnError } from "@/lib/voice/voice-turn-errors";
import { POST } from "./route";

const ORG = "voice-turn-stt-org";

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

function postTurn(id: string, body: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/voice/session/${id}/turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "9.9.9.99" },
      body: JSON.stringify(body),
    }),
    { params: { id } } as unknown as { params: { id: string } }
  );
}

describe("STT-stage error mapping (no masking)", () => {
  it("mock provider + real microphone audio → 503 transcription-unavailable (never 'could not hear')", () => {
    const mapped = mapVoiceTurnError(new Error("Mock voice provider cannot process audio. Use typed transcripts in mock mode."));
    expect(mapped.status).toBe(503);
    expect(mapped.error).toMatch(/transcription is not available/i);
    expect(mapped.error).not.toMatch(/couldn't hear/i);
  });

  it("confirmed empty Whisper result → 400 'could not hear' (only after a successful upload)", () => {
    const mapped = mapVoiceTurnError(new Error("Voice transcription produced no text. Please try again."));
    expect(mapped.status).toBe(400);
    expect(mapped.error).toMatch(/couldn't hear/i);
  });

  it("other provider/config errors keep their existing mapping", () => {
    const mapped = mapVoiceTurnError(new Error("Voice provider is not configured."));
    expect(mapped.status).toBe(400);
    expect(mapped.error).toBe("Invalid input");
    expect(mapVoiceTurnError(new Error("Voice session has ended."))).toEqual({
      status: 410,
      error: "Voice session has ended.",
      code: "ended",
    });
    expect(mapVoiceTurnError(new Error("totally unexpected"))).toEqual({
      status: 500,
      error: "Internal server error",
      code: "server_error",
    });
  });

  it("rate limiting surfaces distinctly (never masked as generic failure)", () => {
    const mapped = mapVoiceTurnError(new Error("Voice transcription is rate-limited right now. Please try again shortly."));
    expect(mapped.status).toBe(429);
    expect(mapped.error).toMatch(/rate.limited|quota|try again shortly/i);
  });
});

describe("POST /api/voice/session/[id]/turn with real audio in mock mode", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values({ id: ORG, name: "Voice Turn STT", slug: `voice-turn-stt-${Date.now()}` });
  });

  afterAll(wipe);

  it("microphone audio on a mock session is rejected as unavailable transcription, not silence", async () => {
    const s = await startVoiceSession({ organizationId: ORG });
    expect(s.mock).toBe(true);
    const res = await postTurn(s.id, {
      transcriptText: "",
      language: "en",
      audioBase64: Buffer.from("fake-mic-bytes").toString("base64"),
      audioMimeType: "audio/webm",
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/transcription is not available/i);
  });

  it("typed transcript on the same mock session still flows through the shared AI pipeline", async () => {
    const s = await startVoiceSession({ organizationId: ORG });
    const res = await postTurn(s.id, { transcriptText: "Hello", language: "en" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.reply).toBe("string");
  });
});
