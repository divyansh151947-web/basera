"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Loader2, X } from "lucide-react";

interface TwoFactorModalProps {
  open: boolean;
  onClose: () => void;
  /** Notified whenever enrollment is enabled or disabled, for the parent row. */
  onStatusChange?: (enabled: boolean) => void;
}

type Step =
  | { name: "loading" }
  | { name: "off" }
  | { name: "setup"; qrDataUrl: string; secret: string; otpauthUri: string }
  | { name: "recovery"; codes: string[] }
  | { name: "on" }
  | { name: "disable" };

/**
 * Enrollment dialog for real TOTP two-factor authentication.
 *
 * Server contract (all session-scoped, rate-limited, no secrets stored in
 * plaintext — the secret is AES-256-GCM encrypted server-side):
 * - POST /api/auth/two-factor/setup    → QR + base32 key (stays PENDING)
 * - POST /api/auth/two-factor/enable   → verifies a code, THEN enables and
 *                                        returns the recovery codes once
 * - POST /api/auth/two-factor/disable  → requires a fresh code to tear down
 *
 * Enrollment is only ever "on" after the server proved possession, so a
 * half-finished setup can never lock anyone out.
 */
export function TwoFactorModal({ open, onClose, onStatusChange }: TwoFactorModalProps) {
  const [step, setStep] = useState<Step>({ name: "loading" });
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLButtonElement | HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus management (mirrors ChangePasswordModal): focus in on open,
  // Escape closes, Tab is trapped, focus returns on close.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const t = setTimeout(() => firstActionRef.current?.focus(), 50);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reset = useCallback(() => {
    setCode("");
    setError("");
    setCopied(false);
    setSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
    setStep({ name: "loading" });
  }, [onClose, reset, submitting]);

  // Load current status each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    reset();
    setStep({ name: "loading" });

    (async () => {
      try {
        const res = await fetch("/api/auth/two-factor/setup");
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(typeof data?.error === "string" ? data.error : "Unable to load two-factor status.");
          setStep({ name: "off" });
          return;
        }
        setStep(data?.enabled ? { name: "on" } : { name: "off" });
      } catch {
        if (cancelled) return;
        setError("Unable to load two-factor status. Please try again.");
        setStep({ name: "off" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, reset]);

  async function beginSetup() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/two-factor/setup", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Unable to start setup. Please try again.");
        return;
      }
      setStep({
        name: "setup",
        qrDataUrl: data.qrDataUrl,
        secret: data.secret,
        otpauthUri: data.otpauthUri,
      });
      setCode("");
    } catch {
      setError("Unable to start setup. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/two-factor/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Invalid code. Please try again.");
        return;
      }
      onStatusChange?.(true);
      setStep({ name: "recovery", codes: Array.isArray(data?.recoveryCodes) ? data.recoveryCodes : [] });
      setCode("");
    } catch {
      setError("Unable to enable two-factor authentication. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDisable(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/two-factor/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Invalid code. Please try again.");
        return;
      }
      onStatusChange?.(false);
      setStep({ name: "off" });
      setCode("");
    } catch {
      setError("Unable to disable two-factor authentication. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; the key stays visible for manual entry.
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="two-factor-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0f1626] p-6 shadow-[0_25px_60px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="two-factor-title" className="text-lg font-semibold text-white">
              Two-Factor Authentication
            </h2>
            <p className="mt-1 text-sm text-white/50">
              Protect your account with a time-based code from an authenticator app.
            </p>
          </div>
          <button
            ref={firstActionRef as React.RefObject<HTMLButtonElement>}
            type="button"
            onClick={handleClose}
            disabled={submitting}
            aria-label="Close two-factor authentication dialog"
            className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {step.name === "loading" && (
          <div className="mt-6 flex items-center gap-2 text-sm text-white/60">
            <Loader2 size={16} className="animate-spin" /> Loading status…
          </div>
        )}

        {step.name === "off" && (
          <div className="mt-5 space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-4">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-white/40" />
              <div className="text-sm text-white/70">
                <p className="font-medium text-white">Not enabled</p>
                <p className="mt-1">
                  You&apos;ll scan a QR code with Google Authenticator, Authy, or any TOTP app, then confirm a
                  6-digit code to turn it on.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={beginSetup}
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#d8a94e] px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-[#e5bc60] disabled:opacity-50"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {submitting ? "Preparing setup…" : "Set up two-factor"}
            </button>
          </div>
        )}

        {step.name === "setup" && (
          <form onSubmit={confirmEnable} className="mt-5 space-y-4">
            <ol className="space-y-2 text-sm text-white/70">
              <li>1. Scan this QR code with your authenticator app.</li>
              <li>2. Or enter the setup key manually.</li>
              <li>3. Enter the 6-digit code it shows to confirm.</li>
            </ol>
            <div className="flex justify-center">
              {/* QR comes from the server as a pre-sized SVG data URI. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={step.qrDataUrl}
                alt="QR code for two-factor authentication setup"
                data-testid="two-factor-qr"
                className="h-44 w-44 rounded-xl bg-white p-2"
              />
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs uppercase tracking-wide text-white/40">Setup key</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code
                  data-testid="two-factor-secret"
                  className="flex-1 break-all font-mono text-sm tracking-wider text-white"
                >
                  {step.secret}
                </code>
                <button
                  type="button"
                  onClick={() => copySecret(step.secret)}
                  aria-label="Copy setup key"
                  className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
                >
                  {copied ? <CheckCircle2 size={15} className="text-green-400" /> : <Copy size={15} />}
                </button>
              </div>
              <p className="mt-1 break-all text-[11px] text-white/35">{step.otpauthUri}</p>
            </div>

            <div>
              <label htmlFor="two-factor-setup-code" className="text-sm font-medium text-white">
                Confirmation code
              </label>
              <input
                id="two-factor-setup-code"
                name="one-time-code"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={32}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                disabled={submitting}
                className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm tracking-[0.3em] text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 disabled:opacity-60"
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-[#d8a94e] px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-[#e5bc60] disabled:opacity-50"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {submitting ? "Verifying…" : "Turn on 2FA"}
              </button>
            </div>
          </form>
        )}

        {step.name === "recovery" && (
          <div className="mt-5 space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-green-500/20 bg-green-500/10 p-4">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-400" />
              <p className="text-sm text-green-300">
                Two-factor authentication is now on. Save these recovery codes somewhere safe — each one works
                once if you lose access to your authenticator app. They are shown only now.
              </p>
            </div>
            <ul
              data-testid="recovery-codes"
              className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/5 p-3 font-mono text-sm text-white"
            >
              {step.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setStep({ name: "on" });
                reset();
              }}
              className="w-full rounded-xl bg-[#d8a94e] px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-[#e5bc60]"
            >
              I&apos;ve saved my recovery codes
            </button>
          </div>
        )}

        {step.name === "on" && (
          <div className="mt-5 space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-green-500/20 bg-green-500/10 p-4">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-400" />
              <div className="text-sm text-green-300">
                <p className="font-medium">Enabled</p>
                <p className="mt-1">Sign-in now requires a 6-digit code from your authenticator app.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setStep({ name: "disable" });
                setCode("");
                setError("");
              }}
              className="w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
            >
              Turn off two-factor authentication
            </button>
          </div>
        )}

        {step.name === "disable" && (
          <form onSubmit={confirmDisable} className="mt-5 space-y-4">
            <p className="text-sm text-white/70">
              Enter a current code from your authenticator app (or a recovery code) to confirm turning 2FA off.
            </p>
            <div>
              <label htmlFor="two-factor-disable-code" className="text-sm font-medium text-white">
                Authentication code
              </label>
              <input
                id="two-factor-disable-code"
                name="one-time-code"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={32}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                disabled={submitting}
                className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm tracking-[0.3em] text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 disabled:opacity-60"
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep({ name: "on" });
                  setCode("");
                  setError("");
                }}
                disabled={submitting}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/70 transition hover:bg-white/10 disabled:opacity-50"
              >
                Keep it on
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-red-500/80 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {submitting ? "Turning off…" : "Turn off 2FA"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
