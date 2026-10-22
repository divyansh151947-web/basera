import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { startVoiceSession } from "@/lib/voice/voice-session";
import {
  getClientIp,
  rateLimitedResponse,
  voiceIpDayLimiter,
  voiceIpMinuteLimiter,
  voiceNewSessionLimiter,
} from "@/lib/rate-limit";

const bodySchema = z.object({
  orgSlug: z.string().min(1).max(128),
  leadId: z.string().min(1).max(64).optional(),
  conversationId: z.string().min(1).max(64).optional(),
  language: z.string().min(1).max(16).optional(),
});

/**
 * POST /api/voice/session — start a browser voice session (Phase 1).
 *
 * Public-visitor scoped exactly like website chat: the organization is
 * resolved server-side from its public slug, a fresh visitor can only ever
 * touch their OWN new/explicitly-passed lead+conversation rows, and IP
 * budgets gate session farming before any AI work. Returns session
 * metadata only — no secrets, no audio, no PII beyond the caller's ids.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const minuteCheck = await voiceIpMinuteLimiter.check(`voice:ip-minute:${ip}`);
  if (!minuteCheck.allowed) return rateLimitedResponse(minuteCheck.retryAfterMs);
  const dayCheck = await voiceIpDayLimiter.check(`voice:ip-day:${ip}`);
  if (!dayCheck.allowed) return rateLimitedResponse(dayCheck.retryAfterMs);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const org = (
    await db.select().from(organizations).where(eq(organizations.slug, parsed.data.orgSlug)).limit(1)
  )[0];
  if (!org) {
    console.warn("[voice/session] public workspace not found in database", { orgSlug: parsed.data.orgSlug });
    return NextResponse.json(
      { error: "Unknown business", code: "ORG_NOT_FOUND", orgSlug: parsed.data.orgSlug },
      { status: 404 }
    );
  }

  if (!parsed.data.leadId && !parsed.data.conversationId) {
    const farmingCheck = await voiceNewSessionLimiter.check(`voice:new-session:${ip}`);
    if (!farmingCheck.allowed) return rateLimitedResponse(farmingCheck.retryAfterMs);
  }

  try {
    const session = await startVoiceSession({
      organizationId: org.id,
      leadId: parsed.data.leadId,
      conversationId: parsed.data.conversationId,
      language: parsed.data.language,
    });
    return NextResponse.json({
      sessionId: session.id,
      leadId: session.leadId,
      conversationId: session.conversationId,
      conversationChannel: session.conversationChannel,
      language: session.language,
      mock: session.mock,
      provider: session.providerId,
      status: session.status,
    });
  } catch (err) {
    if (err instanceof Error && /not found|does not belong/i.test(err.message)) {
      return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    }
    if (err instanceof Error && /not configured/i.test(err.message)) {
      return NextResponse.json({ error: "Voice provider is not configured." }, { status: 503 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
