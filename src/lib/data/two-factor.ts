import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  twoFactorChallenges,
  twoFactorCredentials,
  twoFactorRecoveryCodes,
} from "@/db/schema";

/**
 * Data access for two-factor authentication.
 *
 * Everything here is keyed by the SERVER-side user id derived from the
 * verified session (or from an account that already proved its password) —
 * no caller ever passes another user's id from a request body.
 */

export const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const TWO_FACTOR_CHALLENGE_TTL_LABEL = "5 minutes";

export interface TwoFactorCredentialRow {
  id: string;
  userId: string;
  secretEnc: string;
  enabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getCredentialForUser(userId: string): Promise<TwoFactorCredentialRow | null> {
  const rows = await db
    .select()
    .from(twoFactorCredentials)
    .where(eq(twoFactorCredentials.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * True ONLY when the failure means "the two_factor_* tables were never
 * created in this database" — i.e. migration `0007_two_factor` is still
 * pending (a database created before the 2FA feature shipped, or a fresh
 * deploy where migrations were not run). Recognised signatures:
 *   - SQLite:    code SQLITE_ERROR + `no such table: two_factor_*`
 *   - Postgres:  code 42P01 (undefined_table) naming a two_factor_* relation
 *
 * Every OTHER failure (connection loss, permissions, corruption, a missing
 * unrelated table) returns false so it keeps propagating: a genuine outage
 * must fail closed rather than silently downgrade every account to
 * password-only sign-in.
 */
export function isMissingTwoFactorSchemaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const errCode = typeof code === "string" ? code : "";
  const errMessage = typeof message === "string" ? message : "";
  if (errCode === "42P01") return /two_factor_/i.test(errMessage);
  return errCode === "SQLITE_ERROR" && /no such table:\s*two_factor_/i.test(errMessage);
}

/** Where an operator must go when the 2FA schema is not provisioned yet. */
const TWO_FACTOR_MIGRATION_HINT = "Run `npm run db:migrate` to provision the two_factor_* tables.";

/**
 * 2FA counts as "on" only when enrollment was verified (enabledAt set).
 *
 * This predicate gates EVERY sign-in — it runs inside `authorize` and again
 * in POST /api/auth/two-factor/challenge — so a pending migration must not
 * take down authentication for both buyers and staff. When the table does
 * not exist there are zero enrollment rows, so "2FA off" is factually
 * correct rather than a bypass: password verification is untouched on both
 * paths, and there is no verified challenge to skip because none can exist.
 * The condition is logged loudly (with the remediation) so it is never
 * silent; any other database error still throws and fails closed.
 */
export async function isTwoFactorEnabled(userId: string): Promise<boolean> {
  try {
    const row = await getCredentialForUser(userId);
    return Boolean(row?.enabledAt);
  } catch (error) {
    if (!isMissingTwoFactorSchemaError(error)) throw error;
    console.error(
      `[two-factor] Pending migration: no two_factor_* tables, so no account can have 2FA enabled. ` +
        `Continuing this sign-in with password only (password checks are unchanged). ${TWO_FACTOR_MIGRATION_HINT} ` +
        `userId=${userId} error=${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * Create (or replace) a PENDING enrollment: enabledAt stays NULL, so a
 * half-finished setup can never gate a login. Re-running setup discards any
 * previous unverified secret.
 */
export async function upsertPendingCredential(userId: string, secretEnc: string): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getCredentialForUser(userId);
  if (existing) {
    await db
      .update(twoFactorCredentials)
      .set({ secretEnc, enabledAt: null, updatedAt: now })
      .where(eq(twoFactorCredentials.userId, userId));
    return;
  }
  await db.insert(twoFactorCredentials).values({ userId, secretEnc, enabledAt: null, updatedAt: now });
}

/** Flip a verified pending enrollment to enabled. Idempotent. */
export async function enableCredential(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .update(twoFactorCredentials)
    .set({ enabledAt: now, updatedAt: now })
    .where(and(eq(twoFactorCredentials.userId, userId), isNull(twoFactorCredentials.enabledAt)));
}

/** Full teardown: credential + recovery codes + outstanding challenges. */
export async function disableTwoFactor(userId: string): Promise<void> {
  await db.delete(twoFactorCredentials).where(eq(twoFactorCredentials.userId, userId));
  await db.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId));
  await db.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, userId));
}

// ---------------------------------------------------------------------------
// Login challenges (expiring, bound, single-use)
// ---------------------------------------------------------------------------

export interface TwoFactorChallengeRow {
  id: string;
  userId: string;
  expiresAt: string;
  verifiedAt: string | null;
  usedAt: string | null;
  createdAt: string;
}

export async function createTwoFactorChallenge(userId: string): Promise<TwoFactorChallengeRow> {
  const now = new Date();
  const rows = await db
    .insert(twoFactorChallenges)
    .values({
      userId,
      expiresAt: new Date(now.getTime() + TWO_FACTOR_CHALLENGE_TTL_MS).toISOString(),
      createdAt: now.toISOString(),
    })
    .returning();
  return rows[0];
}

export async function getTwoFactorChallenge(id: string): Promise<TwoFactorChallengeRow | null> {
  if (!id || id.length > 64) return null;
  const rows = await db.select().from(twoFactorChallenges).where(eq(twoFactorChallenges.id, id)).limit(1);
  return rows[0] ?? null;
}

export function isChallengeFresh(challenge: TwoFactorChallengeRow, nowMs: number = Date.now()): boolean {
  if (challenge.usedAt) return false;
  const expires = Date.parse(challenge.expiresAt);
  if (!Number.isFinite(expires)) return false;
  return expires > nowMs;
}

/** Mark the challenge as proven (TOTP/recovery code accepted). Not yet used. */
export async function markChallengeVerified(id: string): Promise<void> {
  await db
    .update(twoFactorChallenges)
    .set({ verifiedAt: new Date().toISOString() })
    .where(and(eq(twoFactorChallenges.id, id), isNull(twoFactorChallenges.verifiedAt)));
}

/**
 * Atomically consume a verified challenge at session-mint time.
 * The conditional UPDATE (verified + unexpired + unused) is what makes the
 * challenge single-use even under concurrent sign-in attempts: exactly one
 * caller can flip used_at.
 *
 * Returns false when the challenge cannot be consumed (already used, never
 * verified, expired, or belonging to another user).
 */
export async function consumeTwoFactorChallenge(
  challengeId: string,
  userId: string,
  nowMs: number = Date.now()
): Promise<boolean> {
  const rows = await db
    .update(twoFactorChallenges)
    .set({ usedAt: new Date(nowMs).toISOString() })
    .where(
      and(
        eq(twoFactorChallenges.id, challengeId),
        eq(twoFactorChallenges.userId, userId),
        isNull(twoFactorChallenges.usedAt),
        sql`${twoFactorChallenges.verifiedAt} IS NOT NULL`,
        sql`${twoFactorChallenges.expiresAt} > ${new Date(nowMs).toISOString()}`
      )
    )
    .returning({ id: twoFactorChallenges.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

export async function replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
  await db.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId));
  if (codeHashes.length === 0) return;
  await db
    .insert(twoFactorRecoveryCodes)
    .values(codeHashes.map((codeHash) => ({ userId, codeHash })));
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  const rows = await db
    .select({ id: twoFactorRecoveryCodes.id })
    .from(twoFactorRecoveryCodes)
    .where(and(eq(twoFactorRecoveryCodes.userId, userId), isNull(twoFactorRecoveryCodes.usedAt)));
  return rows.length;
}

/**
 * Consume one recovery code by hash. The conditional UPDATE guarantees a
 * given code can be spent exactly once, even under a race.
 */
export async function consumeRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
  const rows = await db
    .update(twoFactorRecoveryCodes)
    .set({ usedAt: new Date().toISOString() })
    .where(
      and(
        eq(twoFactorRecoveryCodes.userId, userId),
        eq(twoFactorRecoveryCodes.codeHash, codeHash),
        isNull(twoFactorRecoveryCodes.usedAt)
      )
    )
    .returning({ id: twoFactorRecoveryCodes.id });
  return rows.length > 0;
}
