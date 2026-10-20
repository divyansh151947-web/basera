"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center px-4 py-12 text-sm text-slate">Loading…</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    if (!token) {
      setError("This reset link is invalid or expired.");
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "This reset link is invalid or expired.");
      return;
    }

    setSuccess("Your password has been reset successfully. You can now sign in.");
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="theme-dark flex min-h-screen items-center justify-center bg-[#0a0e16] px-4 py-12">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_55px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-8">
        <Link href="/login" className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline">
          ← Back to sign in
        </Link>

        <div className="mt-6">
          <h1 className="text-2xl font-semibold text-ink">Choose a new password</h1>
          <p className="mt-2 text-sm text-slate">Create a new password for your Basera workspace.</p>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-ink">New password</label>
            <div className="relative mt-1.5">
              <input
                required
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 pr-16 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-slate transition hover:text-brand"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-ink">Confirm password</label>
            <div className="relative mt-1.5">
              <input
                required
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 pr-16 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-slate transition hover:text-brand"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {error && <p className="text-sm font-medium text-danger">{error}</p>}
          {success && <p className="rounded-xl border border-success/20 bg-success-soft px-3 py-2.5 text-sm text-success">{success}</p>}

          <button type="submit" disabled={loading || !token} className="primary-btn w-full">
            {loading ? "Resetting…" : "Reset password"}
          </button>
        </form>
      </div>
    </div>
  );
}
