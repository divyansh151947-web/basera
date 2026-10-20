import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  consumeRecoveryCode,
  getTwoFactorChallenge,
  getCredentialForUser,
  isChallengeFresh,
  markChallengeVerified,
} from "@/lib/data/two-factor";
import {
  decryptTotpSecret,
  hashRecoveryCode,
  isValidRecoveryCodeShape,
  verifyTotp,
} from "@/lib/two-factor";
import { getClientIp, twoFactorVerifyChallengeLimiter, twoFactorVerifyIpLimiter, rateLimitedResponse } from "@/lib/rate-limit";

/**
 * POST /api/auth/two-factor/verify
 *
 * Step 2 of the login challenge: accept a TOTP code (or a recovery code) for
 * a challenge minted by /challenge, and mark that challenge verified. The
 * session itself is still minted by the credentials provider, which
 * re-checks + consumes the challenge — a verified challenge alone is not a
 * session, and it expires after 5 minutes unused.
 *
 * Rate limiting is layered: per-IP budget for spray, plus a per-challenge
 * budget (5 tries) so a single challenge cannot be brute-forced.
 */
const bodySchema = z.object({
  challengeId: z.string().min(1).max(64),
  code: z.string().min(1).max(32),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const ipCheck = await twoFactorVerifyIpLimiter.check(`two-factor:verify-ip:${ip}`);
    if (!ipCheck.allowed) return rateLimitedResponse(ipCheck.retryAfterMs);

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    const { challengeId, code } = parsed.data;

    const challengeCheck = await twoFactorVerifyChallengeLimiter.check(`two-factor:verify-challenge:${challengeId}`);
    if (!challengeCheck.allowed) return rateLimitedResponse(challengeCheck.retryAfterMs);

    const challenge = await getTwoFactorChallenge(challengeId);
    if (!challenge || !isChallengeFresh(challenge)) {
      // Same message for unknown/expired/used: nothing about accounts leaks.
      return NextResponse.json({ error: "This sign-in attempt expired. Please sign in again." }, { status: 400 });
    }

    const credential = await getCredentialForUser(challenge.userId);
    if (!credential?.enabledAt) {
      return NextResponse.json({ error: "This sign-in attempt expired. Please sign in again." }, { status: 400 });
    }

    const normalized = code.replace(/\s+/g, "").toUpperCase();
    let ok = false;

    if (isValidRecoveryCodeShape(normalized)) {
      const hash = hashRecoveryCode(challenge.userId, normalized);
      ok = await consumeRecoveryCode(challenge.userId, hash);
    } else {
      let secret: string;
      try {
        secret = decryptTotpSecret(credential.secretEnc);
      } catch {
        console.error("[two-factor/verify] secret decryption failed; failing closed");
        return NextResponse.json({ error: "Unable to verify your code right now. Please try again later." }, { status: 500 });
      }
      ok = verifyTotp(secret, code);
    }

    if (!ok) {
      return NextResponse.json({ error: "Invalid code. Please try again." }, { status: 401 });
    }

    await markChallengeVerified(challenge.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[two-factor/verify] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
