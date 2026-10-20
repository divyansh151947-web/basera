import { NextRequest, NextResponse } from "next/server";
import { endVoiceSession } from "@/lib/voice/voice-session";
import { getClientIp, rateLimitedResponse, voiceIpDayLimiter, voiceIpMinuteLimiter } from "@/lib/rate-limit";

/**
 * POST /api/voice/session/[id]/end — close a voice session.
 *
 * Transcript and outcomes persist in the standard conversation rows; only
 * the ephemeral registry entry closes. Returns a factual summary.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const ip = getClientIp(req.headers);
    const minuteCheck = await voiceIpMinuteLimiter.check(`voice:ip-minute:${ip}`);
    if (!minuteCheck.allowed) return rateLimitedResponse(minuteCheck.retryAfterMs);
    const dayCheck = await voiceIpDayLimiter.check(`voice:ip-day:${ip}`);
    if (!dayCheck.allowed) return rateLimitedResponse(dayCheck.retryAfterMs);
    return NextResponse.json(await endVoiceSession(params.id));
  } catch (err) {
    if (err instanceof Error && /Voice session not found/i.test(err.message)) {
      return NextResponse.json({ error: "Invalid session" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
