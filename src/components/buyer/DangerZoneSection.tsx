"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertCircle, Loader2 } from "lucide-react";

export function DangerZoneSection() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleClearAllSaved = async () => {
    if (clearing) return;
    setClearing(true);
    setError("");
    setSuccess("");
    try {
      // No propertyId + all=true clears every saved row for the session user.
      const res = await fetch("/api/buyer/saved?all=true", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete saved properties");
      }
      setSuccess("All saved properties deleted.");
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete saved properties");
      setConfirming(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="panel-surface p-5">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <Trash2 size={20} className="text-red-400" /> Danger Zone
      </h2>
      <p className="text-sm text-white/50 mb-4">These actions are irreversible. Proceed with caution.</p>

      {error && (
        <div role="alert" className="mb-3 flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="mb-3 flex items-center gap-2 text-green-400 text-sm bg-green-500/10 border border-green-500/20 rounded-xl p-3">
          {success}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-red-500/20 bg-red-500/10">
          <div>
            <p className="font-medium text-white">Delete All Saved Properties</p>
            <p className="text-sm text-white/50">
              {confirming ? "This cannot be undone. Confirm to remove every saved property." : "Remove all properties from your saved list"}
            </p>
          </div>
          {confirming ? (
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={clearing}
                className="text-sm font-medium text-white/60 hover:text-white border border-white/20 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAllSaved}
                disabled={clearing}
                className="text-sm font-medium text-white bg-red-500 hover:bg-red-400 px-3 py-1.5 rounded-lg transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {clearing && <Loader2 size={14} className="animate-spin" />}
                {clearing ? "Deleting…" : "Yes, delete all"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setError(""); setSuccess(""); setConfirming(true); }}
              className="flex-shrink-0 text-sm font-medium text-red-400 hover:text-red-300 border border-red-400/50 px-4 py-1.5 rounded-lg hover:bg-red-500/10 transition"
            >
              Delete
            </button>
          )}
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl border border-red-500/20 bg-red-500/10">
          <div>
            <p className="font-medium text-white">Delete Account</p>
            <p className="text-sm text-white/50">Permanently delete your account and all data</p>
          </div>
          <button className="text-sm font-medium text-red-400 hover:text-red-300 border border-red-400/50 px-4 py-1.5 rounded-lg hover:bg-red-500/10">Delete Account</button>
        </div>
      </div>
    </div>
  );
}
