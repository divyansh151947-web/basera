import { timingSafeEqual } from "node:crypto";

/**
 * Timing-safe cron-secret comparison. Falls closed when the secret is
 * unconfigured or the candidate is missing/malformed. Length-mismatch
 * is rejected without leaking the expected length via timing.
 */
export function isCronAuthorized(candidate: string | null | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
