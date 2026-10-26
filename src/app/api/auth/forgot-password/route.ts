import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { passwordResetTokens, users } from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/email";
import { normalizeEmail, validateForgotPasswordInput } from "@/lib/validation";
import { forgotEmailLimiter, forgotIpLimiter, getClientIp, rateLimitedResponse } from "@/lib/rate-limit";
import { deleteExpiredPasswordResetTokens } from "@/lib/email-verification";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const validation = validateForgotPasswordInput(body);

  if (validation) {
    return NextResponse.json({ error: validation.message, code: validation.code }, { status: 400 });
  }

  // Reset-mail abuse throttle (H-2). Both gates apply regardless of whether
  // the address exists, so throttling reveals nothing (generic reply below).
  const email = normalizeEmail(body.email);
  const ipCheck = await forgotIpLimiter.check(`forgot:ip:${getClientIp(req.headers)}`);
  const emailCheck = await forgotEmailLimiter.check(`forgot:email:${email}`);
  if (!ipCheck.allowed) return rateLimitedResponse(ipCheck.retryAfterMs);
  if (!emailCheck.allowed) return rateLimitedResponse(emailCheck.retryAfterMs);

  const user = (await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0];

  if (!user) {
    console.info("[auth] Password reset request received for unknown email.");
    return NextResponse.json({
      ok: true,
      message: "If an account exists for that email, we'll send password reset instructions.",
    });
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(rawToken, 12);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  // Opportunistic hygiene: expired rows can never match, so dropping them
  // keeps the token table (and every future scan) bounded.
  await deleteExpiredPasswordResetTokens();

  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const emailResult = await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    token: rawToken,
  });

  if (emailResult.ok) {
    // "Accepted by provider" is the strongest honest claim here: delivery
    // to the inbox is asynchronous and provider-confirmed, never assumed.
    console.info("[auth] Password reset email accepted by provider.", {
      userId: user.id,
      emailId: emailResult.id ?? null,
    });
  } else {
    console.warn("[auth] Password reset email request accepted but delivery failed.", {
      userId: user.id,
      reason: emailResult.reason,
      provider: emailResult.provider,
      error: emailResult.error ?? null,
    });
  }

  return NextResponse.json({
    ok: true,
    message: "If an account exists for that email, we'll send password reset instructions.",
  });
}
