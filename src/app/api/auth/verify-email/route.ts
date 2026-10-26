import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeEmailVerification, markEmailVerified, wasEmailVerificationTokenUsed } from "@/lib/email-verification";
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
    // Replay of a token this requester already used (single-use): tell THEM
    // it's already done so the page can show a helpful state. Only reachable
    // by someone holding the exact emailed token — nothing is revealed to
    // anyone else, who still gets the generic failure below.
    if (await wasEmailVerificationTokenUsed(rawToken)) {
      return NextResponse.json(
        { error: "This email address has already been verified. You can sign in.", code: "ALREADY_VERIFIED" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "This verification link is invalid or expired." }, { status: 400 });
  }

  await markEmailVerified(consumed.userId);
  return NextResponse.json({ ok: true });
}
