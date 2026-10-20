"use client";

import { useEffect, useState } from "react";

type Status = { kind: "idle" | "saving" | "saved" | "error"; message?: string };

export function OrganizationForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/organization")
      .then((r) => r.json())
      .then((data) => {
        if (data.organization) {
          setName(data.organization.name ?? "");
          setPhone(data.organization.phone ?? "");
          setEmail(data.organization.email ?? "");
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    const res = await fetch("/api/organization", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, phone, email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus({ kind: "error", message: data.error ?? "Could not save. Please try again." });
      return;
    }
    setStatus({ kind: "saved", message: "Agency profile saved." });
  }

  return (
    <form onSubmit={save} className="panel-surface space-y-4 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">Brand profile</p>
      <h2 className="text-xl font-semibold text-ink">Agency identity</h2>
      <p className="text-sm text-slate">Broker name and contact info used across AI workflows.</p>
      {!loaded && <p className="text-sm text-slate">Loading…</p>}
      {loaded && (
        <>
          <label className="block text-sm">
            <span className="font-medium text-ink">Agency name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} className="mt-1 w-full rounded-xl border border-line bg-field px-3 py-2 text-ink" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="+91-…" className="mt-1 w-full rounded-xl border border-line bg-field px-3 py-2 text-ink" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" maxLength={160} placeholder="hello@agency.com" className="mt-1 w-full rounded-xl border border-line bg-field px-3 py-2 text-ink" />
          </label>
          <button type="submit" disabled={status.kind === "saving"} className="primary-btn px-4 py-2 text-sm disabled:opacity-60">
            {status.kind === "saving" ? "Saving…" : "Save profile"}
          </button>
          {status.kind === "saved" && <p className="text-sm text-success">{status.message}</p>}
          {status.kind === "error" && <p className="text-sm text-danger">{status.message}</p>}
        </>
      )}
    </form>
  );
}

export function AIConfigForm() {
  const [tone, setTone] = useState("friendly_professional");
  const [greeting, setGreeting] = useState("");
  const [primaryLanguage, setPrimaryLanguage] = useState("auto");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/ai-config")
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setTone(data.config.tone ?? "friendly_professional");
          setGreeting(data.config.greeting ?? "");
          setPrimaryLanguage(data.config.primaryLanguage ?? "auto");
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    const res = await fetch("/api/ai-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tone, greeting, primaryLanguage }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus({ kind: "error", message: data.error ?? "Could not save. Please try again." });
      return;
    }
    setStatus({ kind: "saved", message: "AI behaviour saved." });
  }

  return (
    <form onSubmit={save} className="panel-surface space-y-4 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">AI behaviour</p>
      <h2 className="text-xl font-semibold text-ink">Qualification rules</h2>
      <p className="text-sm text-slate">Tone and greeting used by the website and WhatsApp AI. Scoring thresholds stay at their defaults.</p>
      {!loaded && <p className="text-sm text-slate">Loading…</p>}
      {loaded && (
        <>
          <label className="block text-sm">
            <span className="font-medium text-ink">Tone</span>
            <select value={tone} onChange={(e) => setTone(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-field px-3 py-2 text-ink">
              <option value="friendly_professional">Friendly professional</option>
              <option value="formal">Formal</option>
              <option value="warm_casual">Warm casual</option>
              <option value="concise_direct">Concise direct</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">Greeting</span>
            <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} required minLength={2} maxLength={500} rows={3} className="mt-1 w-full rounded-xl border border-line bg-field px-3 py-2 text-ink" />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-ink">Language</span>
            <select value={primaryLanguage} onChange={(e) => setPrimaryLanguage(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-field px-3 py-2 text-ink">
              <option value="auto">Auto (English / Hindi / Hinglish)</option>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="hinglish">Hinglish</option>
            </select>
          </label>
          <button type="submit" disabled={status.kind === "saving"} className="primary-btn px-4 py-2 text-sm disabled:opacity-60">
            {status.kind === "saving" ? "Saving…" : "Save AI settings"}
          </button>
          {status.kind === "saved" && <p className="text-sm text-success">{status.message}</p>}
          {status.kind === "error" && <p className="text-sm text-danger">{status.message}</p>}
        </>
      )}
    </form>
  );
}
