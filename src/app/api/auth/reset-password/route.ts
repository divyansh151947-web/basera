import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { passwordResetTokens, users } from "@/db/schema";
import { validatePasswordResetInput } from "@/lib/validation";
import { getClientIp, rateLimitedResponse, resetIpLimiter, resetTokenLimiter } from "@/lib/rate-limit";
import { VERIFY_TOKEN_PREFIX } from "@/lib/email-verification";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const validation = validatePasswordResetInput(body);

  if (validation) {
    return NextResponse.json({ error: validation.message, code: validation.code }, { status: 400 });
  }

  // Token brute-force throttle (H-2). Per-IP backstop plus a per-token
  // budget (keyed on a token prefix — server-side only, never logged or
  // returned) so hammering one link doesn't burn the shared IP budget for
  // everyone behind the same address.
  const rawToken = String(body.token ?? "").trim();
  // Namespace guard (Batch 1B-3): email-verification tokens share the token
  // table shape but must never pass as reset credentials. Reject the verify
  // prefix here, before any hash comparison, with the same generic error.
  if (rawToken.startsWith(VERIFY_TOKEN_PREFIX)) {
    return NextResponse.json({ error: "This reset link is invalid or expired.", code: "INVALID_RESET_TOKEN" }, { status: 400 });
  }
  const ipCheck = await resetIpLimiter.check(`reset:ip:${getClientIp(req.headers)}`);
  const tokenCheck = await resetTokenLimiter.check(`reset:token:${rawToken.slice(0, 16)}`);
  if (!ipCheck.allowed) return rateLimitedResponse(ipCheck.retryAfterMs);
  if (!tokenCheck.allowed) return rateLimitedResponse(tokenCheck.retryAfterMs);

  const resetRows = await db.select().from(passwordResetTokens);
  const now = new Date();

  let matchingToken: (typeof passwordResetTokens.$inferSelect) | null = null;
  for (const row of resetRows) {
    if (row.usedAt) continue;
    if (new Date(row.expiresAt).getTime() <= now.getTime()) continue;

    const isValid = await bcrypt.compare(rawToken, row.tokenHash);
    if (isValid) {
      matchingToken = row;
      break;
    }
  }

  if (!matchingToken) {
    console.warn("[auth] Password reset rejected: invalid or expired token.", {
      tokenProvided: Boolean(rawToken),
      tokenLength: rawToken.length,
    });
    return NextResponse.json({ error: "This reset link is invalid or expired.", code: "INVALID_RESET_TOKEN" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(String(body.password), 12);
  const resetTime = new Date().toISOString();

  // D-2: single-use under concurrency. Claim the row atomically BEFORE
  // mutating the password: the conditional `usedAt IS NULL` update wins for
  // exactly one racing caller (the loser gets no claimed row and the generic
  // invalid-token response). A claimed-but-later-failed password write burns
  // the token — the user can request a fresh one — which is why claiming
  // happens first: it is what makes double-consumption impossible.
  const claim = await db
    .update(passwordResetTokens)
    .set({ usedAt: resetTime })
    .where(and(eq(passwordResetTokens.id, matchingToken.id), isNull(passwordResetTokens.usedAt)))
    .returning({ id: passwordResetTokens.id });

  if (claim.length === 0) {
    console.warn("[auth] Password reset rejected: token already consumed concurrently.", {
      tokenProvided: Boolean(rawToken),
      tokenLength: rawToken.length,
    });
    return NextResponse.json({ error: "This reset link is invalid or expired.", code: "INVALID_RESET_TOKEN" }, { status: 400 });
  }

  await db.update(users)
    .set({ passwordHash, updatedAt: resetTime })
    .where(eq(users.id, matchingToken.userId));

  // Stamp all sibling live rows (survivors from re-issued links) so the
  // latest request is the only valid reset credential for this account.
  await db.update(passwordResetTokens)
    .set({ usedAt: resetTime })
    .where(and(eq(passwordResetTokens.userId, matchingToken.userId), isNull(passwordResetTokens.usedAt)));

  return NextResponse.json({ ok: true });
}
