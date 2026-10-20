"use client";

import { useState } from "react";
import { Save, Loader2, AlertCircle, CheckCircle } from "lucide-react";

interface ProfileFormProps {
  userName: string;
  userEmail: string;
  userPhone: string | null | undefined;
}

export function ProfileForm({ userName, userEmail, userPhone }: ProfileFormProps) {
  const [name, setName] = useState(userName);
  const [phone, setPhone] = useState(userPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/buyer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone: phone || null }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess("Profile updated successfully!");
      } else {
        setError(data.error || "Failed to update profile");
      }
    } catch {
      setError("Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-white/60 mb-2">Full Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-white/60 mb-2">Email Address</label>
        <input
          type="email"
          value={userEmail}
          disabled
          className="w-full appearance-none rounded-xl border border-white/10 bg-white/3 px-4 py-2.5 text-sm text-white/50 outline-none cursor-not-allowed"
        />
        <p className="mt-1 text-xs text-white/55">Email cannot be changed. Contact support if you need to update it.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-white/60 mb-2">Phone Number (optional)</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
          className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
        />
      </div>
      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 text-green-400 text-sm bg-green-500/10 border border-green-500/20 rounded-xl p-3">
          <CheckCircle size={16} /> {success}
        </div>
      )}
      <button type="submit" disabled={saving} className="primary-btn w-full flex items-center justify-center gap-2 disabled:opacity-50">
        {saving ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Save size={18} /> Save Changes
          </>
        )}
      </button>
    </form>
  );
}