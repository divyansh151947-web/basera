import "server-only";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { passwordResetTokens, users } from "@/db/schema";

/**
 * EMAIL VERIFICATION TOKENS (Batch 1B-3).
 *
 * NO SCHEMA CHANGE: verification rows reuse the existing
 * password_reset_tokens table (userId, bcrypt tokenHash, expiresAt, usedAt).
 * Cross-use is impossible because of enforced token namespacing:
 *  - verification raw tokens ALWAYS start with VERIFY_TOKEN_PREFIX;
 *  - the reset route rejects that prefix before any comparison;
 *  - consumeEmailVerification() rejects anything without the prefix.
 * A verification row can therefore never reset a password, and a reset
 * token can never verify an email — the prefix is cryptographically bound
 * to the preimage being compared. (Belt and suspenders: reset tokens are
 * bare hex, whose alphabet cannot even produce the "verify_" prefix.)
 *
 * Security properties mirror the reset flow: CSPRNG generation, bcrypt-12
 * hash at rest (raw value exists only in the email link), 24h expiry,
 * single-use via usedAt, generic responses, no token logging anywhere.
 */

export const VERIFY_TOKEN_PREFIX = "verify_";
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Pure format check (unit-testable): is this even shaped like our token? */
export function isVerifyTokenFormat(raw: unknown): raw is string {
  return typeof raw === "string" && raw.startsWith(VERIFY_TOKEN_PREFIX) && raw.length > VERIFY_TOKEN_PREFIX.length + 16;
}

/** Mint a raw token + its bcrypt hash. The raw value leaves only via email. */
export async function buildVerifyToken(): Promise<{ rawToken: string; tokenHash: string }> {
  const rawToken = `${VERIFY_TOKEN_PREFIX}${crypto.randomBytes(32).toString("hex")}`;
  const tokenHash = await bcrypt.hash(rawToken, 12);
  return { rawToken, tokenHash };
}

/** Persist a fresh verification token for a user. Returns the raw token to
 *  the caller (route → mailer). Never logs it — see call sites. Resending
 *  does NOT invalidate older live tokens: every unexpired token stays valid
 *  until its own 24h expiry (each is single-use and bound to this user), so
 *  an earlier email that arrives late still works. */
export async function createEmailVerification(userId: string): Promise<{ rawToken: string; expiresAt: string }> {
  // Opportunistic hygiene: the token table would otherwise grow forever.
  // Expired rows can never match, so deleting them is always safe.
  await deleteExpiredPasswordResetTokens();
  const { rawToken, tokenHash } = await buildVerifyToken();
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS).toISOString();
  await db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });
  return { rawToken, expiresAt };
}

/**
 * Delete expired token rows (both reset and verification — same table).
 * Expires-at is app-written ISO text and indexed, so this is an indexed,
 * bounded delete. Never throws; safe to call opportunistically.
 */
export async function deleteExpiredPasswordResetTokens(): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    await db.delete(passwordResetTokens).where(lte(passwordResetTokens.expiresAt, nowIso));
  } catch {
    // Best-effort hygiene: a failed cleanup must never break the flow that
    // triggered it (signup/resend/forgot-password/reset).
  }
}

/**
 * Consume a verification token: returns the owning userId on success, null
 * otherwise (unknown / expired / already used / wrong namespace). Consumed
 * rows are stamped usedAt so reuse fails. Never throws for bad input.
 *
 * The candidate set is narrowed IN SQL to unused, unexpired rows (both
 * indexed predicates) so each attempt performs a bounded number of bcrypt
 * compares instead of scanning the whole table.
 */
export async function consumeEmailVerification(rawToken: unknown): Promise<{ userId: string } | null> {
  if (!isVerifyTokenFormat(rawToken)) return null;
  const nowIso = new Date().toISOString();
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(and(isNull(passwordResetTokens.usedAt), gte(passwordResetTokens.expiresAt, nowIso)));
  for (const row of rows) {
    if (await bcrypt.compare(rawToken, row.tokenHash)) {
      // Conditional stamp: only the first concurrent consumer wins the row.
      const claimed = await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date().toISOString() })
        .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
        .returning({ id: passwordResetTokens.id });
      if (claimed.length === 0) return null;
      return { userId: row.userId };
    }
  }
  return null;
}

/**
 * True when the raw token matches a USED but still-unexpired verification
 * row. Only ever consulted AFTER consumeEmailVerification fails, and only
 * reachable by someone who demonstrably holds the token (possession of the
 * emailed secret), so answering "already verified" to them reveals nothing
 * an email-access attacker doesn't already have. Bounded: used rows are
 * stamped, expired rows are cleaned up, and resend volume is rate-limited.
 */
export async function wasEmailVerificationTokenUsed(rawToken: unknown): Promise<boolean> {
  if (!isVerifyTokenFormat(rawToken)) return false;
  const nowIso = new Date().toISOString();
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(and(isNotNull(passwordResetTokens.usedAt), gte(passwordResetTokens.expiresAt, nowIso)))
    .limit(50);
  for (const row of rows) {
    if (await bcrypt.compare(rawToken, row.tokenHash)) return true;
  }
  return false;
}

/** Mark the address verified. Idempotent: re-verifying keeps the first stamp. */
export async function markEmailVerified(userId: string): Promise<void> {
  const rows = await db.select({ emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]) return;
  if (rows[0].emailVerifiedAt) return;
  await db.update(users).set({ emailVerifiedAt: new Date().toISOString() }).where(eq(users.id, userId));
}
