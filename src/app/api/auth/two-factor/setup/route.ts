import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getCredentialForUser, upsertPendingCredential } from "@/lib/data/two-factor";
import { buildOtpauthUri, encryptTotpSecret, generateTotpSecret, TOTP_DIGITS, TOTP_PERIOD_SECONDS } from "@/lib/two-factor";
import { getClientIp, twoFactorSetupUserLimiter, rateLimitedResponse } from "@/lib/rate-limit";

/**
 * POST /api/auth/two-factor/setup
 *
 * Enrollment step 1: mint a fresh TOTP secret for the CURRENT session's user
 * and return the two things an authenticator app needs — a QR image (SVG data
 * URI) and the base32 key for manual entry.
 *
 * The stored row stays PENDING (`enabledAt = NULL`), so a setup that is
 * abandoned or never verified cannot lock anyone out: 2FA only takes effect
 * once /enable proves a valid code. Re-running setup discards the previous
 * unverified secret. Rate-limited per user.
 */
export async function POST(_req: NextRequest) {
  try {
    const session = await getCurrentSession();
    const userId = (session?.user as any)?.id as string | undefined;
    if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ip = getClientIp(_req.headers);
    const rl = await twoFactorSetupUserLimiter.check(`two-factor:setup:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const existing = await getCredentialForUser(userId);
    if (existing?.enabledAt) {
      return NextResponse.json(
        { error: "Two-factor authentication is already enabled. Disable it first to re-enroll." },
        { status: 409 }
      );
    }

    const accountName = (session.user as any).email ?? userId;
    const secret = generateTotpSecret();
    await upsertPendingCredential(userId, encryptTotpSecret(secret));

    const otpauthUri = buildOtpauthUri({ secret, accountName });

    // QR rendered server-side (qrcode is a server dependency); returned as an
    // SVG data URI so the client needs no QR library of its own.
    const QRCode = await import("qrcode");
    const svg = await QRCode.toString(otpauthUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    const qrDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

    return NextResponse.json({
      ok: true,
      qrDataUrl,
      secret,
      otpauthUri,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      pending: true,
    });
  } catch (error) {
    console.error("[two-factor/setup] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Status for the security UI: enrollment state, never the secret itself. */
export async function GET() {
  try {
    const session = await getCurrentSession();
    const userId = (session?.user as any)?.id as string | undefined;
    if (!session?.user || !userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const credential = await getCredentialForUser(userId);
    return NextResponse.json({
      enabled: Boolean(credential?.enabledAt),
      pending: Boolean(credential && !credential.enabledAt),
    });
  } catch (error) {
    console.error("[two-factor/setup] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
