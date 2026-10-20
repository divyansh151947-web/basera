"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";

const DRAFT_KEY = "new-lead";
const EMPTY = { name: "", phone: "", preferredCity: "", bhk: "", source: "MANUAL" };
type LeadForm = typeof EMPTY;

export default function NewLeadButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Restore any unsaved draft (browser back / refresh / closed tab) so typed
  // details are never silently lost. Drafts live in sessionStorage only.
  const [form, setForm] = useState<LeadForm>(() => {
    const draft = readDraft<Partial<LeadForm>>(DRAFT_KEY);
    return draft ? { ...EMPTY, ...draft } : EMPTY;
  });
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY);

  // Persist the draft continuously while it differs from the empty form.
  useEffect(() => {
    if (dirty) writeDraft(DRAFT_KEY, form);
    else clearDraft(DRAFT_KEY);
  }, [form, dirty]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        body: JSON.stringify({ ...form, bhk: form.bhk ? Number(form.bhk) : undefined }),
      });
      // Only drop the draft when the server accepted the lead; on failure the
      // modal closes (unchanged behaviour) but the draft survives for retry.
      if (res.ok) clearDraft(DRAFT_KEY);
    } finally {
      setSaving(false);
      setOpen(false);
      router.refresh();
    }
  }

  // Closing with unsaved input asks first — a mis-tap on the backdrop or
  // Cancel can no longer destroy typed details without warning.
  const requestClose = () => {
    if (dirty && !window.confirm("Discard the unsaved lead details?")) return;
    clearDraft(DRAFT_KEY);
    setForm(EMPTY);
    setOpen(false);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md bg-brand text-white px-4 py-2 text-sm font-medium hover:opacity-90">
        + Add lead
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={requestClose}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="bg-panel rounded-lg p-6 w-full max-w-sm space-y-3 max-h-[90vh] overflow-y-auto">
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
              <button type="button" onClick={requestClose} className="px-3 py-1.5 text-sm text-slate2">Cancel</button>
              <button disabled={saving} type="submit" className="px-3 py-1.5 text-sm rounded-md bg-brand text-white">{saving ? "Saving…" : "Add lead"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
