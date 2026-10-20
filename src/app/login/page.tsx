"use client";
import { useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Briefcase, Building2, Home, Shield } from "lucide-react";
import { normalizeEmail } from "@/lib/validation";
import { resolveLoginDestination } from "@/lib/auth-client";
import { AUTH_FAILURE_MESSAGES } from "@/lib/auth-failures";
import { startTwoFactorChallenge, ChallengeStart } from "@/lib/two-factor-login-client";
import { TwoFactorChallengeStep } from "@/components/auth/TwoFactorChallengeStep";

type PendingChallenge = { challengeId: string; expiresAt: string };

export default function StaffLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendState, setResendState] = useState("");
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);

  async function handleChallengeStart(start: ChallengeStart) {
    if (start.kind === "error") {
      setError(start.message);
      setNeedsVerification(Boolean(start.needsVerification));
      setLoading(false);
      return;
    }
    if (start.kind === "challenge") {
      setChallenge({ challengeId: start.challengeId, expiresAt: start.expiresAt });
      setLoading(false);
      return;
    }
    await finishSignIn();
  }

  async function finishSignIn(twoFactorChallengeId?: string) {
    try {
      const normalizedEmail = normalizeEmail(email);
      const res = await signIn("credentials", {
        email: normalizedEmail,
        password,
        redirect: false,
        ...(twoFactorChallengeId ? { twoFactorChallengeId } : {}),
      });

      if (res?.error) {
        if (res.error === "EMAIL_NOT_VERIFIED") {
          setNeedsVerification(true);
          setError("Please verify your email before continuing.");
          return;
        }
        if (res.error === "TWO_FACTOR_REQUIRED") {
          setChallenge(null);
          setError("That sign-in attempt expired. Please sign in again.");
          return;
        }
        const safeMessage = AUTH_FAILURE_MESSAGES[res.error];
        if (safeMessage) {
          // A signal the server deliberately allowed through (see
          // lib/auth-failures.ts). Anything else was replaced with
          // SERVICE_UNAVAILABLE server-side after the real cause was logged,
          // so raw database/driver detail never reaches this UI.
          setError(safeMessage);
          return;
        }
        setError("Invalid email or password.");
        return;
      }

      if (!res || !res.ok) {
        setError("Unable to sign in right now. Please try again.");
        return;
      }

      // signIn(redirect:false) never returns the user role, so resolve the
      // fresh session to route buyers and staff to the correct workspace.
      // Bound the wait so a hanging session fetch cannot leave the button
      // stuck in its loading state (the redirect is re-validated server-side
      // on /dashboard anyway).
      let freshSession: any = null;
      try {
        freshSession = await Promise.race([
          getSession(),
          new Promise<null>((resolve) => setTimeout(resolve, 4000)),
        ]);
      } catch {
        freshSession = null;
      }
      const role = (freshSession?.user as any)?.role as string | undefined;
      const decision = resolveLoginDestination(role, "staff");
      if ("error" in decision) {
        setError("This page is for staff accounts only. Please use the buyer sign in.");
        return;
      }

      router.push(decision.destination);
      router.refresh();
    } catch (err) {
      console.error("[login] signIn failed", err);
      setError("Unable to sign in right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setNeedsVerification(false);
    setResendState("");

    try {
      // Step 1: server re-verifies the password and reports whether a
      // second factor is required (never decided client-side).
      const start = await startTwoFactorChallenge(normalizeEmail(email), password);
      await handleChallengeStart(start);
    } catch (err) {
      console.error("[login] signIn failed", err);
      setError("Unable to sign in right now. Please try again.");
      setLoading(false);
    }
  }

  function abandonChallenge() {
    setChallenge(null);
    setError("");
  }

  async function resendVerification() {
    setResendState("");
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizeEmail(email) }),
      });
    } catch {
      // The endpoint is generic by design; failures stay silent here.
    }
    setResendState("If an account exists for that email, a verification link is on its way.");
  }

  return (
    <main className="theme-dark flex min-h-screen items-center justify-center overflow-x-hidden bg-[#0a0e16] px-4 py-12">
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
            <p className="mt-12 text-sm uppercase tracking-[0.18em] text-white/70">AI-powered sales OS</p>
            <h1 className="mt-4 max-w-xs font-display text-4xl leading-tight text-white">Premium real-estate pipeline intelligence.</h1>
          </div>

          <div className="relative rounded-[1.5rem] border border-white/15 bg-black/45 p-5 backdrop-blur-sm">
            <p className="text-sm text-white/80">Buyer conversations, AI qualification, and property matching — all in one command center.</p>
            <div className="mt-5 flex items-center gap-2 text-sm font-medium text-white">
              Trusted by high-performing brokerage teams <ArrowRight size={16} />
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
              <Briefcase size={20} className="text-blue-400" />
              <h2 className="text-2xl font-semibold text-white">Staff Login</h2>
            </div>
            <p className="mt-2 text-sm text-slate">Sign in to the Basera team dashboard.</p>
          </div>

          {challenge ? (
            <TwoFactorChallengeStep
              challengeId={challenge.challengeId}
              expiresAt={challenge.expiresAt}
              onVerified={(id) => {
                setLoading(true);
                setError("");
                void finishSignIn(id);
              }}
              onBack={abandonChallenge}
              onExpired={() => {
                setChallenge(null);
                setError("That sign-in attempt expired. Please sign in again.");
              }}
            />
          ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="staff-email" className="text-sm font-medium text-white">Email</label>
              <input
                required
                id="staff-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              />
            </div>
            <div>
              <label htmlFor="staff-password" className="text-sm font-medium text-white">Password</label>
              <div className="relative mt-1.5">
                <input
                  required
                  id="staff-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 pr-16 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-white/65 transition hover:text-brand"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Link href="/forgot-password" className="text-sm font-medium text-[#d8a94e] hover:underline">
                Forgot password?
              </Link>
            </div>

            {error && <p className="text-sm font-medium text-red-400">{error}</p>}
            {needsVerification && (
              <div className="text-sm text-slate">
                <button
                  type="button"
                  onClick={resendVerification}
                  className="font-medium text-[#d8a94e] hover:underline"
                >
                  Resend verification email
                </button>
                {resendState && <p className="mt-1">{resendState}</p>}
              </div>
            )}
            <button disabled={loading} type="submit" className="primary-btn w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
          )}

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/65">
            <p className="font-semibold text-white">Demo access</p>
            <p className="mt-1">admin@urbannest.demo / demo1234</p>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/65">
            <p className="font-semibold text-white">Looking to buy a property?</p>
            <p className="mt-1">Access your buyer account to save properties and schedule visits.</p>
            <Link href="/buyer/login" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#d8a94e] hover:underline">
              <Home size={14} /> Buyer Sign In
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}