"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X, Eye, EyeOff, AlertCircle, CheckCircle2 } from "lucide-react";

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Accessible change-password dialog for the buyer Profile & Account page.
 * Talks to POST /api/buyer/change-password, which verifies the current
 * password server-side and (by the M-1 session binding) revokes every
 * existing session for the account on success — hence the explicit
 * "sign in again" success state instead of silently logging out.
 */
export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus management: move focus into the dialog on open, restore it on
  // close, close on Escape, and trap Tab within the dialog.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const t = setTimeout(() => firstInputRef.current?.focus(), 50);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
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
  }, [open, onClose]);

  const resetForm = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setError("");
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    resetForm();
    setSuccess(false);
    onClose();
  }, [onClose, resetForm, submitting]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError("");

    // Inline validation before the network call.
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      setError("All three password fields are required.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from your current password.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/buyer/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "Unable to change your password. Please try again.");
        return;
      }

      // Clear sensitive fields immediately on success.
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setSuccess(true);
    } catch {
      setError("Unable to change your password. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
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
        aria-labelledby="change-password-title"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f1626] p-6 shadow-[0_25px_60px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="change-password-title" className="text-lg font-semibold text-white">
              Change Password
            </h2>
            <p className="mt-1 text-sm text-white/50">
              For your security, changing your password signs you out on all devices.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            aria-label="Close change password dialog"
            className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {success ? (
          <div className="mt-6 space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-green-500/20 bg-green-500/10 p-4">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-green-400" />
              <p className="text-sm text-green-300">
                Your password has been changed successfully. For your security, you&apos;ve been signed out on all
                devices — please sign in with your new password.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setSuccess(false);
                onClose();
                router.push("/buyer/login");
                router.refresh();
              }}
              className="w-full rounded-xl bg-[#d8a94e] px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-[#e5bc60]"
            >
              Sign in with new password
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="current-password" className="text-sm font-medium text-white">
                Current password
              </label>
              <div className="relative mt-1.5">
                <input
                  ref={firstInputRef}
                  id="current-password"
                  type={showCurrent ? "text" : "password"}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 pr-16 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  aria-label={showCurrent ? "Hide current password" : "Show current password"}
                  className="absolute inset-y-0 right-0 flex items-center gap-1 px-3 text-xs font-semibold text-white/65 transition hover:text-[#ffdf9e]"
                >
                  {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showCurrent ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="new-password" className="text-sm font-medium text-white">
                New password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="new-password"
                  type={showNew ? "text" : "password"}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 pr-16 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  aria-label={showNew ? "Hide new password" : "Show new password"}
                  className="absolute inset-y-0 right-0 flex items-center gap-1 px-3 text-xs font-semibold text-white/65 transition hover:text-[#ffdf9e]"
                >
                  {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showNew ? "Hide" : "Show"}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-white/40">At least 8 characters, different from your current password.</p>
            </div>

            <div>
              <label htmlFor="confirm-new-password" className="text-sm font-medium text-white">
                Confirm new password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="confirm-new-password"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 pr-16 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? "Hide confirmed password" : "Show confirmed password"}
                  className="absolute inset-y-0 right-0 flex items-center gap-1 px-3 text-xs font-semibold text-white/65 transition hover:text-[#ffdf9e]"
                >
                  {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showConfirm ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
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
                {submitting ? "Changing…" : "Change password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
