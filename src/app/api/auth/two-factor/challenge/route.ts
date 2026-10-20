import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { normalizeEmail } from "@/lib/validation";
import { shouldBlockUnverifiedLogin, findUserByEmail } from "@/lib/auth";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createTwoFactorChallenge, isTwoFactorEnabled, isMissingTwoFactorSchemaError } from "@/lib/data/two-factor";
import {
  getClientIp,
  headersFromReq,
  loginAccountLimiter,
  twoFactorChallengeIpLimiter,
  rateLimitedResponse,
} from "@/lib/rate-limit";

/**
 * POST /api/auth/two-factor/challenge
 *
 * Step 1 of the login challenge: re-verifies the password (never trusts the
 * caller) and, only for accounts with 2FA enabled, mints a short-lived
 * challenge that /verify can mark and `authorize` can consume exactly once.
 *
 * Responses are shaped so an unauthenticated caller cannot learn whether an
 * account has 2FA on: wrong password and "no 2FA" both end at 401/200 paths
 * that a plain sign-in would also produce. The per-account budget is shared
 * with the credentials provider (same `login:account:` key), so password
 * guessing here draws down the exact same pool as guessing at sign-in.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req.headers);
    const ipCheck = await twoFactorChallengeIpLimiter.check(`two-factor:challenge-ip:${ip}`);
    if (!ipCheck.allowed) return rateLimitedResponse(ipCheck.retryAfterMs);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const normalizedEmail = normalizeEmail((body as { email?: unknown }).email);
    const password = (body as { password?: unknown }).password;
    if (!normalizedEmail || typeof password !== "string" || !password) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const accountCheck = await loginAccountLimiter.check(`login:account:${normalizedEmail}`);
    if (!accountCheck.allowed) return rateLimitedResponse(accountCheck.retryAfterMs);

    const user = await findUserByEmail(normalizedEmail);
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    // Same email-ownership gate as `authorize` so this endpoint cannot be
    // used to sidestep it, and so the client sees one consistent error code.
    let orgForGate: { isDemo?: boolean | null } | null = null;
    if (user.organizationId) {
      const orgRows = await db
        .select({ isDemo: organizations.isDemo })
        .from(organizations)
        .where(eq(organizations.id, user.organizationId))
        .limit(1);
      orgForGate = orgRows[0] ?? null;
    }
    if (shouldBlockUnverifiedLogin(user.emailVerifiedAt, orgForGate)) {
      return NextResponse.json({ error: "EMAIL_NOT_VERIFIED" }, { status: 403 });
    }

    if (!(await isTwoFactorEnabled(user.id))) {
      // Nothing to challenge — the client should just sign in normally.
      return NextResponse.json({ required: false });
    }

    const challenge = await createTwoFactorChallenge(user.id);
    return NextResponse.json({
      required: true,
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
    });
  } catch (error) {
    // Full detail stays in the terminal (name, message, stack) — the browser
    // only ever sees the generic body below, so no database/driver text can
    // leak through this path.
    console.error("[two-factor/challenge] error:", error);
    if (isMissingTwoFactorSchemaError(error)) {
      console.error(
        "[two-factor/challenge] the database is missing the two_factor_* tables. Run `npm run db:migrate` to provision them."
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
