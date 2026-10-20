"use client";

import { useEffect, useState } from "react";

type State = { phoneNumberId: string; displayPhoneNumber: string; businessAccountId: string };

export default function WhatsAppIntegration() {
  const [form, setForm] = useState<State>({ phoneNumberId: "", displayPhoneNumber: "", businessAccountId: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [environmentConfigured, setEnvironmentConfigured] = useState(false);

  useEffect(() => {
    fetch("/api/integrations/whatsapp").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load WhatsApp settings");
      setForm({ phoneNumberId: data.config?.phoneNumberId || "", displayPhoneNumber: data.config?.displayPhoneNumber || "", businessAccountId: data.config?.businessAccountId || "" });
      setEnvironmentConfigured(Boolean(data.environmentConfigured));
    }).catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/integrations/whatsapp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save WhatsApp settings");
      setNotice("WhatsApp phone number has been linked to this workspace.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save WhatsApp settings"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="panel-surface p-5 text-sm text-slate">Loading WhatsApp connection…</div>;
  return <section className="panel-surface p-5">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">Channel integration</p><h2 className="mt-2 text-xl font-semibold text-ink">WhatsApp Business</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate">Inbound customer messages are routed through Basera’s existing qualification, property matching, scoring, and handoff workflow.</p></div><span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.09em] ${environmentConfigured && form.phoneNumberId ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{environmentConfigured && form.phoneNumberId ? "Configured" : "Setup required"}</span></div>
    <form onSubmit={save} className="mt-5 grid gap-4 md:grid-cols-2">
      <label className="text-sm font-medium text-ink">Meta phone number ID<input required value={form.phoneNumberId} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} className="mt-1.5 w-full rounded-xl border border-line bg-field px-3 py-2 text-sm" placeholder="From WhatsApp Manager" /></label>
      <label className="text-sm font-medium text-ink">Display phone number<input value={form.displayPhoneNumber} onChange={(e) => setForm({ ...form, displayPhoneNumber: e.target.value })} className="mt-1.5 w-full rounded-xl border border-line bg-field px-3 py-2 text-sm" placeholder="+91 98…" /></label>
      <label className="text-sm font-medium text-ink md:col-span-2">Business account ID <span className="font-normal text-slate">optional</span><input value={form.businessAccountId} onChange={(e) => setForm({ ...form, businessAccountId: e.target.value })} className="mt-1.5 w-full rounded-xl border border-line bg-field px-3 py-2 text-sm" placeholder="From Meta Business Manager" /></label>
      {notice && <p className="text-sm text-emerald-700 md:col-span-2">{notice}</p>}{error && <p className="text-sm text-danger md:col-span-2">{error}</p>}
      <div className="md:col-span-2"><button disabled={saving} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : "Save connection"}</button></div>
    </form>
    <div className="mt-5 rounded-xl border border-line bg-[var(--panel-soft)] p-4 text-sm leading-6 text-slate"><p className="font-semibold text-ink">Meta setup checklist</p><ol className="mt-2 list-decimal space-y-1 pl-5"><li>Add server-only WhatsApp credentials to your deployment environment.</li><li>In Meta, set the callback URL to <code className="rounded bg-[var(--panel-2)] px-1">/api/webhooks/whatsapp</code> and use the verify token from <code className="rounded bg-[var(--panel-2)] px-1">WHATSAPP_VERIFY_TOKEN</code>.</li><li>Subscribe to messages, then save this number’s Meta ID above. Access tokens are never entered or shown here.</li></ol></div>
  </section>;
}
