import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeEmailVerification, markEmailVerified } from "@/lib/email-verification";
import { getClientIp, rateLimitedResponse, verifyEmailLimiter, verifyTokenLimiter } from "@/lib/rate-limit";

const bodySchema = z.object({ token: z.string().min(1).max(256) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "This verification link is invalid or expired." }, { status: 400 });
  }

  // Abuse throttle: per-IP backstop + per-token budget. Same generic reply
  // either way so throttling reveals nothing about token validity.
  const rawToken = parsed.data.token.trim();
  const ipCheck = await verifyEmailLimiter.check(`verify:ip:${getClientIp(req.headers)}`);
  const tokenCheck = await verifyTokenLimiter.check(`verify:token:${rawToken.slice(0, 32)}`);
  if (!ipCheck.allowed) return rateLimitedResponse(ipCheck.retryAfterMs);
  if (!tokenCheck.allowed) return rateLimitedResponse(tokenCheck.retryAfterMs);

  const consumed = await consumeEmailVerification(rawToken);
  if (!consumed) {
    return NextResponse.json({ error: "This verification link is invalid or expired." }, { status: 400 });
  }

  await markEmailVerified(consumed.userId);
  return NextResponse.json({ ok: true });
}
