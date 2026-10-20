"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center px-4 py-12 text-sm text-slate">Loading…</div>}>
      <VerifyEmailForm />
    </Suspense>
  );
}

function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<"verifying" | "done" | "error">("verifying");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("This verification link is invalid or expired.");
      return;
    }
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        setState("done");
      })
      .catch(() => {
        setState("error");
        setError("This verification link is invalid or expired.");
      });
  }, [token]);

  return (
    <div className="theme-dark flex min-h-screen items-center justify-center bg-[#0a0e16] px-4 py-12">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_55px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-8">
        <Link href="/login" className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline">
          ← Back to sign in
        </Link>

        <div className="mt-6">
          <h1 className="text-2xl font-semibold text-ink">Email verification</h1>
          {state === "verifying" && <p className="mt-2 text-sm text-slate">Verifying your email…</p>}
          {state === "done" && (
            <>
              <p className="mt-2 rounded-xl border border-success/20 bg-success-soft px-3 py-2.5 text-sm text-success">
                Your email has been verified successfully. You can now sign in.
              </p>
              <Link href="/login" className="primary-btn mt-6 block text-center">
                Sign in
              </Link>
            </>
          )}
          {state === "error" && <p className="mt-2 text-sm font-medium text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}
