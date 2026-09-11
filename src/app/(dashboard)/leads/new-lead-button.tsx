"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewLeadButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", preferredCity: "", bhk: "", source: "MANUAL" });
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/leads", {
      method: "POST",
      body: JSON.stringify({ ...form, bhk: form.bhk ? Number(form.bhk) : undefined }),
    });
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md bg-brand text-white px-4 py-2 text-sm font-medium hover:opacity-90">
        + Add lead
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="bg-panel rounded-lg p-6 w-full max-w-sm space-y-3">
            <h2 className="font-semibold text-ink">Add a lead manually</h2>
            <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" />
            <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" />
            <input placeholder="Preferred city" value={form.preferredCity} onChange={(e) => setForm({ ...form, preferredCity: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" />
            <input placeholder="BHK" type="number" value={form.bhk} onChange={(e) => setForm({ ...form, bhk: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" />
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-slate2">Cancel</button>
              <button disabled={saving} type="submit" className="px-3 py-1.5 text-sm rounded-md bg-brand text-white">{saving ? "Saving…" : "Add lead"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
