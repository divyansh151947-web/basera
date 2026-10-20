import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import { consumeRecoveryCode, getCredentialForUser, disableTwoFactor } from "@/lib/data/two-factor";
import { decryptTotpSecret, hashRecoveryCode, isValidRecoveryCodeShape, verifyTotp } from "@/lib/two-factor";
import { getClientIp, twoFactorEnableUserLimiter, rateLimitedResponse } from "@/lib/rate-limit";

/**
 * POST /api/auth/two-factor/disable
 *
 * Turning 2FA off requires proving possession again (a fresh TOTP code or an
 * unused recovery code) while already signed in — a stolen session alone is
 * not enough to strip the second factor. The teardown removes the encrypted
 * secret, every recovery code, and any outstanding login challenge.
 */
const bodySchema = z.object({ code: z.string().min(1).max(32) });

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    const userId = (session?.user as any)?.id as string | undefined;
    if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ip = getClientIp(req.headers);
    const rl = await twoFactorEnableUserLimiter.check(`two-factor:disable:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const credential = await getCredentialForUser(userId);
    if (!credential?.enabledAt) {
      return NextResponse.json({ error: "Two-factor authentication is not enabled." }, { status: 409 });
    }

    const normalized = parsed.data.code.replace(/\s+/g, "").toUpperCase();
    let ok = false;

    if (isValidRecoveryCodeShape(normalized)) {
      const hash = hashRecoveryCode(userId, normalized);
      ok = await consumeRecoveryCode(userId, hash);
    } else {
      let secret: string;
      try {
        secret = decryptTotpSecret(credential.secretEnc);
      } catch {
        console.error("[two-factor/disable] secret decryption failed; failing closed");
        return NextResponse.json({ error: "Unable to verify your code right now. Please try again later." }, { status: 500 });
      }
      ok = verifyTotp(secret, parsed.data.code);
    }

    if (!ok) {
      return NextResponse.json({ error: "Invalid code. Please try again." }, { status: 401 });
    }

    await disableTwoFactor(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[two-factor/disable] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
