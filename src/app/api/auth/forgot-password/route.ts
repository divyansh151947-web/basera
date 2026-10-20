import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { passwordResetTokens, users } from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/email";
import { normalizeEmail, validateForgotPasswordInput } from "@/lib/validation";
import { forgotEmailLimiter, forgotIpLimiter, getClientIp, rateLimitedResponse } from "@/lib/rate-limit";

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
    console.info("[auth] Password reset email request accepted and delivered.", {
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
