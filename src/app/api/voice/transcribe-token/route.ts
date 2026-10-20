import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVoiceSessionOrThrow } from "@/lib/voice/voice-session";
import { geminiVoiceIsConfigured } from "@/lib/voice/gemini-voice-provider";
import { transcribeLiveModelId } from "@/lib/voice/transcribe-live-provider";
import {
  getClientIp,
  rateLimitedResponse,
  voiceIpDayLimiter,
  voiceIpMinuteLimiter,
} from "@/lib/rate-limit";

const bodySchema = z.object({
  /** Active Basera voice session the Transcribe Live connection belongs to. The token
   *  is minted only for sessions already bound to the gemini provider. */
  sessionId: z.string().min(1).max(64),
});

/**
 * POST /api/voice/transcribe-token — mint a single-use ephemeral token for a
 * direct browser→Gemini Transcribe Live API WebSocket (transcription only).
 *
 * SECURITY: GEMINI_API_KEY never leaves the server. Minting uses it in the
 * x-goog-api-key header only; the response carries just the short-lived
 * token NAME (uses:1, 30-minute expiry, 1-minute session-start window).
 * The token is bound at issuance to an ACTIVE Basera voice session, and
 * issuance itself counts against the existing per-IP voice rate limits, so
 * a token can never be farmed without a real session. Token/key values are
 * never logged.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const minuteCheck = await voiceIpMinuteLimiter.check(`voice:ip-minute:${ip}`);
  if (!minuteCheck.allowed) return rateLimitedResponse(minuteCheck.retryAfterMs);
  const dayCheck = await voiceIpDayLimiter.check(`voice:ip-day:${ip}`);
  if (!dayCheck.allowed) return rateLimitedResponse(dayCheck.retryAfterMs);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  let session;
  try {
    session = await getVoiceSessionOrThrow(parsed.data.sessionId);
  } catch {
    return NextResponse.json({ error: "Invalid session" }, { status: 404 });
  }
  if (session.status !== "ACTIVE") {
    return NextResponse.json({ error: "Voice session has ended." }, { status: 410 });
  }
  if (session.providerId !== "gemini" || !geminiVoiceIsConfigured()) {
    return NextResponse.json({ error: "Voice provider is not configured." }, { status: 503 });
  }
  // GEMINI_LIVE_ENABLED defaults to true (enabled). Set to "false" to disable live transcription.
  if (process.env.GEMINI_LIVE_ENABLED === "false") {
    return NextResponse.json({ error: "Voice provider is not configured." }, { status: 503 });
  }

  const now = Date.now();
  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      res = await fetch("https://generativelanguage.googleapis.com/v1alpha/auth_tokens", {
        method: "POST",
        headers: {
          "x-goog-api-key": process.env.GEMINI_API_KEY as string,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          uses: 1,
          expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
          newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return NextResponse.json({ error: "Voice provider is not configured." }, { status: 503 });
  }
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    const errMsg = errData?.error?.message || "";
    if (res.status === 429 || /quota|resource.exhausted/i.test(errMsg)) {
      return NextResponse.json({ error: "Voice provider quota exceeded. Please try again later." }, { status: 429 });
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "Voice provider authentication failed. Check server configuration." }, { status: 503 });
    }
    return NextResponse.json({ error: "Voice provider is not configured." }, { status: 503 });
  }
  const data = (await res.json().catch(() => null)) as { name?: unknown } | null;
  if (!data || typeof data.name !== "string" || !data.name) {
    return NextResponse.json({ error: "Voice provider is not configured." }, { status: 503 });
  }
  return NextResponse.json({
    token: data.name,
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
    // Single source of truth for the Transcribe Live model: the client must use exactly
    // this (verified-working ids rotate as Google retires models).
    model: transcribeLiveModelId(),
  });
}