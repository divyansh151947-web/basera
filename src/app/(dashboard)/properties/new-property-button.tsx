"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewPropertyButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    projectName: "", developer: "", propertyType: "APARTMENT", bhk: "", city: "", locality: "",
    priceMinInr: "", priceMaxInr: "", areaSqft: "", description: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch("/api/properties", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        bhk: form.bhk ? Number(form.bhk) : undefined,
        priceMinInr: Number(form.priceMinInr || 0),
        priceMaxInr: Number(form.priceMaxInr || 0),
        areaSqft: form.areaSqft ? Number(form.areaSqft) : undefined,
      }),
    });
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md bg-brand text-white px-4 py-2 text-sm font-medium hover:opacity-90">
        + Add property
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="bg-panel rounded-lg p-6 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-ink">Add a property</h2>
            <input required placeholder="Project name" value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" />
            <input placeholder="Developer" value={form.developer} onChange={(e) => setForm({ ...form, developer: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <select value={form.propertyType} onChange={(e) => setForm({ ...form, propertyType: e.target.value })} className="rounded-md border border-line px-3 py-2 text-sm">
                {["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="BHK" type="number" value={form.bhk} onChange={(e) => setForm({ ...form, bhk: e.target.value })}
                className="rounded-md border border-line px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input required placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="rounded-md border border-line px-3 py-2 text-sm" />
              <input required placeholder="Locality" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })}
                className="rounded-md border border-line px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input required placeholder="Min price (₹)" type="number" value={form.priceMinInr} onChange={(e) => setForm({ ...form, priceMinInr: e.target.value })}
                className="rounded-md border border-line px-3 py-2 text-sm" />
              <input required placeholder="Max price (₹)" type="number" value={form.priceMaxInr} onChange={(e) => setForm({ ...form, priceMaxInr: e.target.value })}
                className="rounded-md border border-line px-3 py-2 text-sm" />
            </div>
            <input placeholder="Area (sqft)" type="number" value={form.areaSqft} onChange={(e) => setForm({ ...form, areaSqft: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" />
            <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-md border border-line px-3 py-2 text-sm" rows={3} />
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-slate2">Cancel</button>
              <button disabled={saving} type="submit" className="px-3 py-1.5 text-sm rounded-md bg-brand text-white">{saving ? "Saving…" : "Add property"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
