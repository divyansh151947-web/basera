"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await res.json().catch(() => ({}));
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }

    setSuccess(data.message ?? "If an account exists for that email, a reset link has been sent.");
    setEmail("");
  }

  return (
    <div className="theme-dark flex min-h-screen items-center justify-center bg-[#0a0e16] px-4 py-12">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_55px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-8">
        <Link href="/login" className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline">
          ← Back to sign in
        </Link>

        <div className="mt-6">
          <h1 className="text-2xl font-semibold text-ink">Reset your password</h1>
          <p className="mt-2 text-sm text-slate">
            Enter your work email and we’ll send a secure reset link if the account exists.
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-ink">Work email</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>

          {error && <p className="text-sm font-medium text-danger">{error}</p>}
          {success && <p className="rounded-xl border border-success/20 bg-success-soft px-3 py-2.5 text-sm text-success">{success}</p>}

          <button type="submit" disabled={loading} className="primary-btn w-full">
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      </div>
    </div>
  );
}
