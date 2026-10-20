"use client";

/**
 * Shared client half of the two-factor login flow (used by both login pages).
 *
 * Flow:
 * 1. `startTwoFactorChallenge(email, password)` asks the server to
 *    re-verify the password. It answers one of:
 *    - "signin"    → account has no 2FA; caller signs in normally.
 *    - "challenge" → account has 2FA; caller shows the code step.
 *    - "error"     → wrong password / unverified email / rate limited.
 * 2. `verifyTwoFactorChallenge(challengeId, code)` marks the challenge
 *    verified. Only then does the caller call
 *    `signIn("credentials", { ..., twoFactorChallengeId })`.
 *
 * The password is never sent anywhere except these two first-party
 * endpoints, and a failed/expired challenge simply restarts at step 1.
 */

export type ChallengeStart =
  | { kind: "signin" }
  | { kind: "challenge"; challengeId: string; expiresAt: string }
  | { kind: "error"; message: string; needsVerification?: boolean };

export async function startTwoFactorChallenge(email: string, password: string): Promise<ChallengeStart> {
  let res: Response;
  try {
    res = await fetch("/api/auth/two-factor/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    // Network trouble: fall back to a plain sign-in attempt (which will
    // re-run the same gates server-side) rather than locking the user out.
    return { kind: "signin" };
  }

  if (res.status === 403) {
    const body = await res.json().catch(() => null);
    if (body?.error === "EMAIL_NOT_VERIFIED") {
      return { kind: "error", message: "Please verify your email before continuing.", needsVerification: true };
    }
    return { kind: "error", message: "Please verify your email before continuing.", needsVerification: true };
  }
  if (res.status === 401) {
    // Same message the plain sign-in path shows, so probing this endpoint
    // reveals nothing about which accounts exist.
    return { kind: "error", message: "Invalid email or password." };
  }
  if (res.status === 429) {
    // Throttling is an *expected* failure, not a server fault. Reporting it
    // as "Unable to sign in right now" sends a legitimate user into a retry
    // loop that deepens their own lockout, so surface the server's own
    // (already non-sensitive) explanation instead.
    const body = await res.json().catch(() => null);
    const message =
      typeof body?.error === "string" && body.error
        ? body.error
        : "Too many sign-in attempts. Please wait a few minutes and try again.";
    return { kind: "error", message };
  }
  if (!res.ok) {
    return { kind: "error", message: "Unable to sign in right now. Please try again." };
  }

  const body = (await res.json().catch(() => null)) as {
    required?: boolean;
    challengeId?: string;
    expiresAt?: string;
  } | null;

  if (body?.required && body.challengeId && body.expiresAt) {
    return { kind: "challenge", challengeId: body.challengeId, expiresAt: body.expiresAt };
  }
  return { kind: "signin" };
}

export type ChallengeVerifyResult =
  | { ok: true }
  | { ok: false; message: string; expired?: boolean };

export async function verifyTwoFactorChallenge(challengeId: string, code: string): Promise<ChallengeVerifyResult> {
  try {
    const res = await fetch("/api/auth/two-factor/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, code }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => null);
    const message = typeof body?.error === "string" ? body.error : "Invalid code. Please try again.";
    const expired = /expired/i.test(message);
    return { ok: false, message, expired };
  } catch {
    return { ok: false, message: "Unable to verify your code right now. Please try again." };
  }
}
