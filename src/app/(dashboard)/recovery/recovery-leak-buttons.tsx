"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Per-leak Execute / Dismiss controls. Thin client island: POSTs to the
 * autopilot action APIs (which enforce tenant scope, assignment scope, and
 * idempotency server-side) and refreshes the page data on success.
 */
export function RecoveryLeakButtons({
  leadId,
  leakType,
  status,
}: {
  leadId: string;
  leakType: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"execute" | "dismiss" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function call(action: "execute" | "dismiss") {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/revenue/recovery/actions/${encodeURIComponent(leadId)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leakType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error ?? "Request failed.");
      } else if (action === "execute" && data?.executed === false) {
        setMessage(data?.reason ?? "No recovery warranted.");
      } else {
        router.refresh();
      }
    } catch {
      setMessage("Request failed.");
    } finally {
      setBusy(null);
    }
  }

  if (status === "DISMISSED" || status === "IN_PROGRESS") {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        disabled={busy != null}
        onClick={() => call("execute")}
        className="ghost-btn text-brand"
      >
        {busy === "execute" ? "Working…" : "Execute"}
      </button>
      <button
        type="button"
        disabled={busy != null}
        onClick={() => call("dismiss")}
        className="ghost-btn"
      >
        {busy === "dismiss" ? "Working…" : "Dismiss"}
      </button>
      {message && <span className="max-w-[220px] truncate text-xs text-slate">{message}</span>}
    </div>
  );
}
