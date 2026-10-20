"use client";

import { useCallback, useEffect, useState } from "react";
import { Shield, LogOut } from "lucide-react";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { TwoFactorModal } from "./TwoFactorModal";

export function AccountSecuritySection() {
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);

  const refreshTwoFactorStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/two-factor/setup");
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      setTwoFactorEnabled(Boolean(data?.enabled));
    } catch {
      // Leave the status unknown rather than claiming a state we didn't see.
    }
  }, []);

  useEffect(() => {
    void refreshTwoFactorStatus();
  }, [refreshTwoFactorStatus]);

  return (
    <div className="panel-surface p-5">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Shield size={20} className="text-[#d8a94e]" /> Account Security
      </h2>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20">
              <Shield size={18} className="text-blue-400" />
            </div>
            <div>
              <p className="font-medium text-white">Change Password</p>
              <p className="text-sm text-white/50">Update your login password</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setChangePasswordOpen(true)}
            aria-haspopup="dialog"
            className="text-sm font-medium text-[#d8a94e] hover:underline"
          >
            Change
          </button>
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20">
              <Shield size={18} className="text-purple-400" />
            </div>
            <div>
              <p className="font-medium text-white">Two-Factor Authentication</p>
              <p className="text-sm text-white/50">
                {twoFactorEnabled === null
                  ? "Time-based one-time codes (TOTP)"
                  : twoFactorEnabled
                    ? "Enabled — codes required at sign-in"
                    : "Add an extra layer of security"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTwoFactorOpen(true)}
            aria-haspopup="dialog"
            data-testid="two-factor-manage"
            className="text-sm font-medium text-[#d8a94e] hover:underline"
          >
            {twoFactorEnabled === null ? "Loading…" : twoFactorEnabled ? "Manage" : "Set up"}
          </button>
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/20">
              <LogOut size={18} className="text-orange-400" />
            </div>
            <div>
              <p className="font-medium text-white">Active Sessions</p>
              <p className="text-sm text-white/50">View and manage logged-in devices</p>
            </div>
          </div>
          <span className="text-xs font-medium text-white/40 uppercase tracking-wide">Coming soon</span>
        </div>
      </div>

      <ChangePasswordModal open={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
      <TwoFactorModal
        open={twoFactorOpen}
        onClose={() => setTwoFactorOpen(false)}
        onStatusChange={(enabled) => setTwoFactorEnabled(enabled)}
      />
    </div>
  );
}
