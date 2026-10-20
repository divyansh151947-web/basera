"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { verifyTwoFactorChallenge } from "@/lib/two-factor-login-client";

/**
 * The second-factor step shown by the login pages after the server reports
 * that the account has 2FA enabled. It only marks the challenge verified —
 * the session is still minted by the credentials sign-in that follows, so a
 * verified code alone never produces a session.
 */
export function TwoFactorChallengeStep({
  challengeId,
  expiresAt,
  onVerified,
  onBack,
  onExpired,
}: {
  challengeId: string;
  expiresAt: string;
  /** Called after the server accepted the code for this challenge. */
  onVerified: (challengeId: string) => void;
  /** Abandon the challenge and return to the password form. */
  onBack: () => void;
  /** The challenge hit its 5-minute TTL — caller should reset the flow. */
  onExpired: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() => Date.parse(expiresAt) - Date.now());

  // Live countdown so the 5-minute TTL is visible instead of surprising.
  useEffect(() => {
    setRemainingMs(Date.parse(expiresAt) - Date.now());
    const timer = setInterval(() => {
      const left = Date.parse(expiresAt) - Date.now();
      setRemainingMs(left);
      if (left <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (remainingMs <= 0) onExpired();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs <= 0]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");

    const result = await verifyTwoFactorChallenge(challengeId, code);
    if (result.ok) {
      onVerified(challengeId);
    } else if (result.expired) {
      onExpired();
    } else {
      setError(result.message);
    }
    setSubmitting(false);
  }

  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div className="flex items-center gap-2 text-sm text-white/70">
        <KeyRound size={16} className="text-[#d8a94e]" />
        <span>Two-factor authentication</span>
      </div>
      <p className="text-sm text-white/65">
        Enter the 6-digit code from your authenticator app, or one of your recovery codes.
      </p>
      <div>
        <label htmlFor="two-factor-code" className="text-sm font-medium text-white">
          Authentication code
        </label>
        <input
          required
          id="two-factor-code"
          name="one-time-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9A-Za-z]*"
          maxLength={32}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm tracking-[0.3em] text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-red-400">
          {error}
        </p>
      )}
      <p className="text-xs text-white/45" data-testid="two-factor-expiry">
        Code expires in {mm}:{ss}
      </p>

      <button disabled={submitting} type="submit" className="primary-btn w-full">
        {submitting ? "Verifying…" : "Verify code"}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="w-full text-sm font-medium text-white/60 transition hover:text-white"
      >
        Back to password
      </button>
    </form>
  );
}
