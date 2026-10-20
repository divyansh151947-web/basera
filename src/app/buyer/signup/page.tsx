"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { ArrowRight, Home, Shield } from "lucide-react";
import { normalizeBuyerSignupInput, validateBuyerSignupInput } from "@/lib/validation";

export default function BuyerSignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setErrorCode("");

    const validation = validateBuyerSignupInput(normalizeBuyerSignupInput(form));
    if (validation) {
      setError(validation.message);
      setErrorCode(validation.code);
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth/buyer-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizeBuyerSignupInput(form)),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      setErrorCode(data.code ?? "VALIDATION_ERROR");
      setLoading(false);
      return;
    }

    const signinRes = await signIn("credentials", { email: normalizeBuyerSignupInput(form).email, password: normalizeBuyerSignupInput(form).password, redirect: false });
    setLoading(false);
    if (signinRes?.error) {
      router.push("/buyer/login");
      return;
    }
    router.push("/buyer");
    router.refresh();
  }

  return (
    <div className="theme-dark flex min-h-screen items-center justify-center bg-[#0a0e16] px-4 py-12">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.04] shadow-[0_25px_60px_rgba(0,0,0,0.45)] backdrop-blur-sm md:grid-cols-[1.05fr_0.95fr]">
        <div className="relative hidden overflow-hidden p-8 text-white md:flex md:flex-col md:justify-between">
          {/* Plain img: pre-sized asset, no sharp runtime dependency. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/villa-pool.jpg"
            alt=""
            aria-hidden
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#060a12]/95 via-[#060a12]/55 to-[#060a12]/30" aria-hidden />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-lg font-semibold text-white">B</span>
              <span className="font-display text-3xl text-white">Basera</span>
            </div>
            <p className="mt-12 text-sm uppercase tracking-[0.18em] text-white/70">Find your home</p>
            <h1 className="mt-4 max-w-xs font-display text-4xl leading-tight text-white">Discover verified properties and connect with agents.</h1>
          </div>

          <div className="relative rounded-[1.5rem] border border-white/15 bg-black/45 p-5 backdrop-blur-sm">
            <p className="text-sm text-white/80">Save favorites, get AI-matched recommendations, and schedule site visits.</p>
            <div className="mt-5 flex items-center gap-2 text-sm font-medium text-white">
              Start exploring in minutes <ArrowRight size={16} />
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <Link href="/" className="flex items-center gap-3 md:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-[#d8a94e] to-[#8a6238] text-lg font-semibold text-[#1a1206]">B</span>
            <span className="font-display text-3xl text-white">Basera</span>
          </Link>

          <div className="mt-7 md:mt-12">
            <div className="flex items-center gap-2 mb-4">
              <Home size={20} className="text-[#d8a94e]" />
              <h2 className="text-2xl font-semibold text-white">Create Buyer Account</h2>
            </div>
            <p className="mt-2 text-sm text-slate">Save properties, get matched, and connect with agents.</p>
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="signup-name" className="text-sm font-medium text-white">Your name</label>
              <input
                required
                id="signup-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              />
            </div>
            <div>
              <label htmlFor="signup-email" className="text-sm font-medium text-white">Email</label>
              <input
                required
                id="signup-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              />
            </div>
            <div>
              <label htmlFor="signup-password" className="text-sm font-medium text-white">Password</label>
              <div className="relative mt-1.5">
                <input
                  required
                  id="signup-password"
                  minLength={8}
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
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
              <label htmlFor="signup-phone" className="text-sm font-medium text-white">Phone (optional)</label>
              <input
                id="signup-phone"
                type="tel"
                value={form.phone ?? ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
                placeholder="+91 98765 43210"
              />
            </div>
            {error && (
              <div className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2.5 text-sm text-red-400" aria-live="polite">
                <span>{error}</span>
                {errorCode === "EMAIL_EXISTS" && (
                  <>
                    {" "}
                    <Link href="/buyer/login" className="font-semibold underline underline-offset-2">Sign in</Link>
                  </>
                )}
              </div>
            )}
            <button disabled={loading} type="submit" className="primary-btn w-full">
              {loading ? "Creating your account…" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-sm text-slate">
            Already have an account? <Link href="/buyer/login" className="font-semibold text-[#d8a94e]">Sign in</Link>
          </p>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate">
            <p className="font-semibold text-white">Basera employee?</p>
            <p className="mt-1">Access the team dashboard and CRM tools.</p>
            <Link href="/login" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-400 hover:underline">
              <Shield size={14} /> Staff Login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}