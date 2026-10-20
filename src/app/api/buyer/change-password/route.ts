import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getCurrentSession } from "@/lib/auth";
import { validateChangePasswordInput } from "@/lib/validation";
import { changePasswordUserLimiter, rateLimitedResponse } from "@/lib/rate-limit";

/**
 * POST /api/buyer/change-password
 *
 * Authenticated password change for the CURRENT buyer only:
 * - Identity comes from the verified server session — never from a
 *   client-supplied user id — so a buyer cannot target another account.
 * - The current password is verified against the stored bcrypt hash before
 *   anything is written.
 * - The new password is validated against the app password policy
 *   (min 8 chars, must differ from the current one, confirmation match).
 * - The stored hash is replaced with a fresh bcrypt hash (cost 12).
 * - Because the session JWT is bound to the password hash at sign-in
 *   (auth.ts M-1 passwordVersion binding), changing the password revokes
 *   every previously issued session for this account, including this one.
 *   The client surfaces that explicitly after success.
 * - Per-user rate limit (5 / 15 min) blunts brute-forcing the current
 *   password from a hijacked session.
 *
 * Passwords are never logged or echoed in responses.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if ((session.user as any).role !== "BUYER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = (session.user as any).id as string;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await changePasswordUserLimiter.check(`change-password:user:${userId}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const body = await req.json().catch(() => ({}));
    const validation = validateChangePasswordInput(body);
    if (validation) {
      return NextResponse.json({ error: validation.message, code: validation.code }, { status: 400 });
    }

    const { currentPassword, newPassword } = body as {
      currentPassword: string;
      newPassword: string;
      confirmNewPassword: string;
    };

    const rows = await db
      .select({ id: users.id, passwordHash: users.passwordHash, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = rows[0];
    if (!user || !user.isActive) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the CURRENT password against the stored hash. A wrong current
    // password is rejected before any write and without revealing whether
    // the account exists beyond the session already proving it.
    const currentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentValid) {
      return NextResponse.json(
        { error: "Your current password is incorrect.", code: "CURRENT_PASSWORD_INVALID" },
        { status: 400 }
      );
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    const changedAt = new Date().toISOString();
    const updated = await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: changedAt })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (!updated[0]) {
      return NextResponse.json({ error: "Unable to update your password. Please try again." }, { status: 500 });
    }

    // Success. The M-1 password binding invalidates all prior sessions for
    // this account on their next request (including this browser session),
    // so the client directs the user to sign in again with the new password.
    return NextResponse.json({ ok: true, reauthRequired: true });
  } catch (error) {
    console.error("[buyer/change-password] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
