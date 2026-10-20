import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { voiceTurn } from "@/lib/voice/voice-session";
import { mapVoiceTurnError } from "@/lib/voice/voice-turn-errors";
import { VOICE_MAX_AUDIO_BYTES } from "@/lib/voice/openai-voice-provider";
import {
  getClientIp,
  rateLimitedResponse,
  voiceIpDayLimiter,
  voiceIpMinuteLimiter,
  voiceSessionTurnLimiter,
} from "@/lib/rate-limit";

const bodySchema = z.object({
  // Optional when audioBase64 carries the turn (live transcription fills it
  // in); required-and-validated otherwise by the provider below.
  transcriptText: z.string().max(2000).optional().default(""),
  language: z.string().min(1).max(16).optional(),
  /** Phase 2: browser-captured audio (base64). Never stored server-side. */
  audioBase64: z.string().max(Math.ceil((VOICE_MAX_AUDIO_BYTES * 4) / 3) + 1024).optional(),
  audioMimeType: z.string().max(64).optional(),
});

/**
 * POST /api/voice/session/[id]/turn — one voice turn.
 *
 * Transcript TEXT (mock STT stand-in, typed input, or live-provider typed
 * fallback) or browser-captured AUDIO (live provider: transcribed
 * server-side, never stored). The transcript flows through the existing
 * Basera AI pipeline; the reply comes back as text plus live-provider audio.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = getClientIp(req.headers);
  const minuteCheck = await voiceIpMinuteLimiter.check(`voice:ip-minute:${ip}`);
  if (!minuteCheck.allowed) return rateLimitedResponse(minuteCheck.retryAfterMs);
  const dayCheck = await voiceIpDayLimiter.check(`voice:ip-day:${ip}`);
  if (!dayCheck.allowed) return rateLimitedResponse(dayCheck.retryAfterMs);
  const turnCheck = await voiceSessionTurnLimiter.check(`voice:turns:${params.id}`);
  if (!turnCheck.allowed) return rateLimitedResponse(turnCheck.retryAfterMs);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  try {
    const result = await voiceTurn({
      sessionId: params.id,
      transcriptText: parsed.data.transcriptText,
      language: parsed.data.language,
      audioBase64: parsed.data.audioBase64 ?? null,
      audioMimeType: parsed.data.audioMimeType ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    const mapped = mapVoiceTurnError(err);
    if (mapped.status === 500) {
      console.error(err);
    } else if (mapped.status === 503 && process.env.NODE_ENV !== "production") {
      console.debug("[voice] turn rejected:", mapped.error);
    }
    return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status });
  }
}
