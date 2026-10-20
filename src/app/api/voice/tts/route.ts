import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVoiceSessionOrThrow } from "@/lib/voice/voice-session";
import { createProviderById } from "@/lib/voice/voice-session";
import { geminiTtsIsConfigured } from "@/lib/voice/gemini-tts-provider";
import {
  getClientIp,
  rateLimitedResponse,
  voiceIpDayLimiter,
  voiceIpMinuteLimiter,
  voiceSessionTurnLimiter,
} from "@/lib/rate-limit";

const bodySchema = z.object({
  /** The session ID for which to synthesize speech. */
  sessionId: z.string().min(1).max(64),
  /** The text to synthesize. Must be the final Basera response text. */
  text: z.string().min(1).max(2000),
  /** Optional language hint for voice selection. */
  language: z.enum(["en", "hi", "hinglish"]).optional(),
});

/**
 * POST /api/voice/tts — synthesize speech from text using the session's TTS provider.
 *
 * Called by the client after receiving the final Basera response text.
 * Returns WAV audio (base64) for immediate playback.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const minuteCheck = await voiceIpMinuteLimiter.check(`voice:tts-ip-minute:${ip}`);
  if (!minuteCheck.allowed) return rateLimitedResponse(minuteCheck.retryAfterMs);
  const dayCheck = await voiceIpDayLimiter.check(`voice:tts-ip-day:${ip}`);
  if (!dayCheck.allowed) return rateLimitedResponse(dayCheck.retryAfterMs);
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const sessionId = parsed.data.sessionId;
  const turnCheck = await voiceSessionTurnLimiter.check(`voice:tts-turns:${sessionId}`);
  if (!turnCheck.allowed) return rateLimitedResponse(turnCheck.retryAfterMs);

  let session;
  try {
    session = await getVoiceSessionOrThrow(sessionId);
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

  // If the session is using the new cascade (gemini-tts), use the TTS provider directly
  // Otherwise fall back to the session's provider
  const language = parsed.data.language ?? session.language;
  let synth;
  try {
    synth = await provider.synthesizeReply({
      replyText: parsed.data.text,
      language: language as "en" | "hi" | "hinglish",
      conversationId: session.conversationId,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("quota")) {
      return NextResponse.json({ error: "Voice TTS quota exceeded. Please try again later." }, { status: 429 });
    }
    if (err instanceof Error && err.message.includes("timed out")) {
      return NextResponse.json({ error: "Voice TTS timed out. Please try again." }, { status: 408 });
    }
    console.error("[voice] TTS error:", err);
    return NextResponse.json({ error: "Voice synthesis failed. Please try again." }, { status: 500 });
  }

  return NextResponse.json({
    audioBase64: synth.audioBase64,
    audioMimeType: synth.audioMimeType,
    mock: synth.mock,
    processingNote: synth.processingNote,
    providerMetadata: synth.providerMetadata,
  });
}