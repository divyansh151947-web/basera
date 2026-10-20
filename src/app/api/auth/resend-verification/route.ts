import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { normalizeEmail, validateForgotPasswordInput } from "@/lib/validation";
import { sendVerificationEmail } from "@/lib/email";
import { createEmailVerification } from "@/lib/email-verification";
import { getClientIp, rateLimitedResponse, verifyResendEmailLimiter, verifyResendIpLimiter } from "@/lib/rate-limit";

/**
 * Re-send the verification email. Always returns the same generic response
 * whether the address exists, is already verified, or is unknown — no
 * enumeration. Rate limited per IP and per address.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const validation = validateForgotPasswordInput(body);
  if (validation) {
    return NextResponse.json({ error: validation.message, code: validation.code }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const ipCheck = await verifyResendIpLimiter.check(`verify-resend:ip:${getClientIp(req.headers)}`);
  const emailCheck = await verifyResendEmailLimiter.check(`verify-resend:email:${email}`);
  if (!ipCheck.allowed) return rateLimitedResponse(ipCheck.retryAfterMs);
  if (!emailCheck.allowed) return rateLimitedResponse(emailCheck.retryAfterMs);

  const user = (await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1))[0];

  // Only unverified, existing accounts get mail — but the reply is identical
  // in every case (existing, verified, or unknown).
  if (user && !user.emailVerifiedAt) {
    try {
      const { rawToken } = await createEmailVerification(user.id);
      const result = await sendVerificationEmail({ to: user.email, name: user.name, token: rawToken });
      if (!result.ok) {
        console.warn("[auth] Verification email deferred.", { userId: user.id, reason: result.reason });
      }
    } catch (error) {
      console.error("[auth] Verification resend failed.", { userId: user.id });
    }
  }

  return NextResponse.json({
    ok: true,
    message: "If an account exists for that email, a verification link is on its way.",
  });
}
