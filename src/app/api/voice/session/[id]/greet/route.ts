import { NextRequest, NextResponse } from "next/server";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { messages } from "@/db/schema";
import { addMessage } from "@/lib/data/conversations";
import { createProviderById, getVoiceSessionOrThrow } from "@/lib/voice/voice-session";
import { VOICE_GREETING_MARKER, VOICE_GREETING_TEXT } from "@/lib/voice/voice-greeting";
import { getClientIp, rateLimitedResponse, voiceIpDayLimiter, voiceIpMinuteLimiter } from "@/lib/rate-limit";

/**
 * POST /api/voice/session/[id]/greet — the automatic assistant greeting.
 *
 * Called once by the client right after microphone access succeeds. The
 * greeting is persisted as a real AI message on the session conversation
 * (idempotent via metadata marker — reopening never duplicates it) and
 * synthesized through the SESSION's own provider (never a fallback vendor).
 * No audio is stored; the browser plays the returned bytes.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = getClientIp(req.headers);
  const minuteCheck = await voiceIpMinuteLimiter.check(`voice:ip-minute:${ip}`);
  if (!minuteCheck.allowed) return rateLimitedResponse(minuteCheck.retryAfterMs);
  const dayCheck = await voiceIpDayLimiter.check(`voice:ip-day:${ip}`);
  if (!dayCheck.allowed) return rateLimitedResponse(dayCheck.retryAfterMs);
  let session;
  try {
    session = await getVoiceSessionOrThrow(params.id);
  } catch {
    return NextResponse.json({ error: "Invalid session" }, { status: 404 });
  }
  if (session.status !== "ACTIVE") {
    return NextResponse.json({ error: "Voice session has ended." }, { status: 410 });
  }

  let provider;
  try {
    provider = await createProviderById(session.providerId);
  } catch (err) {
    if (err instanceof Error && /not configured/i.test(err.message)) {
      return NextResponse.json({ error: "Voice provider is not configured." }, { status: 503 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    const existing = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, session.conversationId),
          eq(messages.sender, "AI"),
          like(messages.metadataJson, `%"${VOICE_GREETING_MARKER}":true%`)
        )
      )
      .limit(1);
    const alreadyGreeted = existing.length > 0;
    if (!alreadyGreeted) {
      await addMessage(session.conversationId, "AI", VOICE_GREETING_TEXT, {
        metadata: { channel: "VOICE", [VOICE_GREETING_MARKER]: true, language: session.language },
      });
    }
    // TTS is best-effort; if synthesis fails (quota, outage), we still return
    // the greeting text so the client can use its fallback speech synthesis.
    let synth;
    try {
      synth = await provider.synthesizeReply({
        replyText: VOICE_GREETING_TEXT,
        language: session.language,
        conversationId: session.conversationId,
      });
    } catch (err) {
      synth = {
        audioBase64: null,
        audioMimeType: null,
        mock: false,
        processingNote: "TTS unavailable; using browser fallback.",
        providerMetadata: { ttsMissed: true, ttsMissedReason: err instanceof Error ? err.message : "synthesis failed" },
      };
    }
    return NextResponse.json({
      greeting: VOICE_GREETING_TEXT,
      audioBase64: synth.audioBase64,
      audioMimeType: synth.audioMimeType,
      mock: synth.mock,
      alreadyGreeted,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
