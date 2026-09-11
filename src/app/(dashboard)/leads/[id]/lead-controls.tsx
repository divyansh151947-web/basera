"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "INTERESTED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED", "LOST", "NURTURE"];

export default function LeadControls({ conversationId, leadId, team, lead }: { conversationId: string; leadId: string; team: any[]; lead: any }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function sendAsAgent() {
    if (!message.trim()) return;
    setSending(true);
    await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: message, takeOver: true }),
    });
    setMessage("");
    setSending(false);
    router.refresh();
  }

  async function updateField(field: string, value: any) {
    await fetch(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <div className="flex gap-2">
        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type a message to take over the conversation…"
          className="flex-1 rounded-md border border-line px-3 py-2 text-sm" />
        <button onClick={sendAsAgent} disabled={sending} className="rounded-md bg-brand text-white px-4 py-2 text-sm font-medium">
          {sending ? "Sending…" : "Send & take over"}
        </button>
      </div>
      <div className="flex gap-3 flex-wrap items-center text-sm">
        <label className="flex items-center gap-2">
          Status
          <select defaultValue={lead.status} onChange={(e) => updateField("status", e.target.value)} className="border border-line rounded-md px-2 py-1">
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Assign to
          <select defaultValue={lead.assignedAgentId ?? ""} onChange={(e) => updateField("assignedAgentId", e.target.value || null)} className="border border-line rounded-md px-2 py-1">
            <option value="">Unassigned</option>
            {team.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
