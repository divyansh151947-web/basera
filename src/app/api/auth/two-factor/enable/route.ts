import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth";
import {
  countUnusedRecoveryCodes,
  enableCredential,
  getCredentialForUser,
  replaceRecoveryCodes,
} from "@/lib/data/two-factor";
import { decryptTotpSecret, generateRecoveryCodes, hashRecoveryCode, verifyTotp } from "@/lib/two-factor";
import { getClientIp, twoFactorEnableUserLimiter, rateLimitedResponse } from "@/lib/rate-limit";

/**
 * POST /api/auth/two-factor/enable
 *
 * Enrollment step 2: prove possession of the authenticator app by submitting
 * a valid TOTP code for the PENDING secret. Only then does `enabledAt` get
 * set — enrollment is verified before enabling, exactly as required.
 *
 * On success it also mints recovery codes (returned ONCE, in this response
 * only) and stores just their salted hashes. A wrong code changes nothing.
 */
const bodySchema = z.object({ code: z.string().min(1).max(32) });

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    const userId = (session?.user as any)?.id as string | undefined;
    if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ip = getClientIp(req.headers);
    const rl = await twoFactorEnableUserLimiter.check(`two-factor:enable:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const credential = await getCredentialForUser(userId);
    if (!credential) {
      return NextResponse.json({ error: "No setup in progress. Start the setup step first." }, { status: 400 });
    }
    if (credential.enabledAt) {
      return NextResponse.json({ error: "Two-factor authentication is already enabled." }, { status: 409 });
    }

    let secret: string;
    try {
      secret = decryptTotpSecret(credential.secretEnc);
    } catch {
      console.error("[two-factor/enable] secret decryption failed; failing closed");
      return NextResponse.json({ error: "Unable to verify your code right now. Please run setup again." }, { status: 500 });
    }

    if (!verifyTotp(secret, parsed.data.code)) {
      return NextResponse.json({ error: "Invalid code. Please try again." }, { status: 401 });
    }

    await enableCredential(userId);

    const recoveryCodes = generateRecoveryCodes();
    await replaceRecoveryCodes(userId, recoveryCodes.map((c) => hashRecoveryCode(userId, c)));

    return NextResponse.json({ ok: true, recoveryCodes });
  } catch (error) {
    console.error("[two-factor/enable] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** How many unused recovery codes remain (never the codes themselves). */
export async function GET() {
  try {
    const session = await getCurrentSession();
    const userId = (session?.user as any)?.id as string | undefined;
    if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const remaining = await countUnusedRecoveryCodes(userId);
    return NextResponse.json({ remaining });
  } catch (error) {
    console.error("[two-factor/enable] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
