"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, X } from "lucide-react";
import { PropertyMediaUpload } from "@/components/PropertyMediaUpload";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";

interface EditPropertyFormProps {
  propertyId: string;
  organizationId: string;
  onCancel?: () => void;
  onSaved?: () => void;
}

interface PropertyData {
  id: string;
  projectName: string;
  developer: string | null;
  propertyType: string;
  bhk: number | null;
  city: string;
  locality: string;
  address: string | null;
  priceMinInr: number;
  priceMaxInr: number;
  areaSqft: number | null;
  floor: string | null;
  furnishing: string | null;
  possessionDate: string | null;
  availability: string;
  description: string | null;
  imagesJson: string;
  amenitiesJson: string;
  parking: boolean;
  videoUrl: string | null;
  videoPosterUrl: string | null;
}

/** Editable form fields (mirrors the initial state below). */
interface EditFormState {
  projectName: string;
  developer: string;
  propertyType: string;
  bhk: string;
  city: string;
  locality: string;
  address: string;
  priceMinInr: string;
  priceMaxInr: string;
  areaSqft: string;
  floor: string;
  furnishing: string;
  possessionDate: string;
  availability: string;
  description: string;
  amenities: string[];
  parking: boolean;
}

/** sessionStorage key for a property's unsaved edit draft. */
const draftKey = (propertyId: string) => `edit-property:${propertyId}`;

function parseImages(imagesJson: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((u: unknown) => typeof u === "string") : [];
  } catch {
    return [];
  }
}

function parseAmenities(amenitiesJson: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(amenitiesJson ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function EditPropertyForm({ propertyId, organizationId, onCancel, onSaved }: EditPropertyFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [property, setProperty] = useState<PropertyData | null>(null);
  // Serialized server-loaded form — the "clean" reference for dirty checks.
  const baselineRef = useRef<string | null>(null);
  // True when a previous unsaved draft was restored on mount (surfaced in
  // the UI so the user knows why fields differ from the saved record).
  const [draftRestored, setDraftRestored] = useState(false);

  const [form, setForm] = useState<EditFormState>({
    projectName: "",
    developer: "",
    propertyType: "APARTMENT",
    bhk: "",
    city: "",
    locality: "",
    address: "",
    priceMinInr: "",
    priceMaxInr: "",
    areaSqft: "",
    floor: "",
    furnishing: "",
    possessionDate: "",
    availability: "AVAILABLE",
    description: "",
    amenities: [] as string[],
    parking: false,
  });

  const fetchProperty = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}`);
      if (!res.ok) {
        setError("Failed to load property.");
        return;
      }
      const data = await res.json();
      const p = data.property;
      setProperty(p);
      const loaded: EditFormState = {
        projectName: p.projectName ?? "",
        developer: p.developer ?? "",
        propertyType: p.propertyType ?? "APARTMENT",
        bhk: p.bhk?.toString() ?? "",
        city: p.city ?? "",
        locality: p.locality ?? "",
        address: p.address ?? "",
        priceMinInr: p.priceMinInr?.toString() ?? "",
        priceMaxInr: p.priceMaxInr?.toString() ?? "",
        areaSqft: p.areaSqft?.toString() ?? "",
        floor: p.floor ?? "",
        furnishing: p.furnishing ?? "",
        possessionDate: p.possessionDate ?? "",
        availability: p.availability ?? "AVAILABLE",
        description: p.description ?? "",
        amenities: parseAmenities(p.amenitiesJson),
        parking: p.parking ?? false,
      };
      baselineRef.current = JSON.stringify(loaded);
      // Restore an unsaved draft (browser back / refresh) only when it
      // actually differs from the saved record; otherwise fall back clean.
      const draft = readDraft<Partial<EditFormState>>(draftKey(propertyId));
      const merged = draft ? { ...loaded, ...draft } : loaded;
      if (JSON.stringify(merged) !== baselineRef.current) {
        setForm(merged);
        setDraftRestored(true);
      } else {
        setForm(loaded);
        setDraftRestored(false);
      }
    } catch {
      setError("Failed to load property.");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    fetchProperty();
  }, [fetchProperty]);

  // Data preservation on back: persist unsaved edits continuously. When the
  // form matches the saved record again (save or explicit discard) the draft
  // is removed. Runs only on form changes, so a post-save clear is not
  // immediately re-written.
  useEffect(() => {
    if (baselineRef.current === null) return;
    if (JSON.stringify(form) === baselineRef.current) clearDraft(draftKey(propertyId));
    else writeDraft(draftKey(propertyId), form);
  }, [form, propertyId]);

  const discardDraft = () => {
    clearDraft(draftKey(propertyId));
    if (baselineRef.current !== null) setForm(JSON.parse(baselineRef.current) as EditFormState);
    setDraftRestored(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: form.projectName,
          developer: form.developer || undefined,
          propertyType: form.propertyType,
          bhk: form.bhk ? Number(form.bhk) : undefined,
          city: form.city,
          locality: form.locality,
          address: form.address || undefined,
          priceMinInr: Number(form.priceMinInr || 0),
          priceMaxInr: Number(form.priceMaxInr || 0),
          areaSqft: form.areaSqft ? Number(form.areaSqft) : undefined,
          floor: form.floor || undefined,
          furnishing: form.furnishing || undefined,
          possessionDate: form.possessionDate || undefined,
          availability: form.availability,
          description: form.description || undefined,
          amenitiesJson: JSON.stringify(form.amenities),
          parking: form.parking,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save property.");
        return;
      }

      showSuccess("Property saved successfully.");
      // Saved — drop the local draft and re-baseline the dirty check.
      clearDraft(draftKey(propertyId));
      baselineRef.current = JSON.stringify(form);
      setDraftRestored(false);
      if (onSaved) onSaved();
      router.refresh();
    } catch {
      setError("Failed to save property. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const showSuccess = (msg: string) => {
    setError("");
    // Use a simple success state
    const el = document.getElementById("edit-property-success");
    if (el) {
      el.textContent = msg;
      el.style.display = "block";
      setTimeout(() => { el.style.display = "none"; }, 3000);
    }
  };

  const addAmenity = () => {
    setForm((f) => ({ ...f, amenities: [...f.amenities, ""] }));
  };

  const updateAmenity = (index: number, value: string) => {
    setForm((f) => {
      const amenities = [...f.amenities];
      amenities[index] = value;
      return { ...f, amenities };
    });
  };

  const removeAmenity = (index: number) => {
    setForm((f) => ({ ...f, amenities: f.amenities.filter((_, i) => i !== index) }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-white/50" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="text-center py-12 text-white/50">
        Property not found.
        {onCancel && (
          <button onClick={onCancel} className="ml-2 text-[#ffdf9e] hover:underline">
            Go back
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Success message */}
      <div
        id="edit-property-success"
        className="hidden text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-xl p-3"
      />

      {/* Error message */}
      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          {error}
        </div>
      )}

      {/* Restored draft notice — explains why fields may differ from the
          saved record and offers a one-click revert. */}
      {draftRestored && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#d8a94e]/30 bg-[#d8a94e]/10 p-3 text-sm text-[#ffdf9e]">
          <span>Unsaved draft restored — edits from your previous visit are shown below.</span>
          <button
            type="button"
            onClick={discardDraft}
            className="shrink-0 underline underline-offset-4 hover:opacity-80"
          >
            Discard draft
          </button>
        </div>
      )}

      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-white/80">Basic Information</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Project Name *</label>
            <input
              required
              value={form.projectName}
              onChange={(e) => setForm({ ...form, projectName: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Developer</label>
            <input
              value={form.developer}
              onChange={(e) => setForm({ ...form, developer: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Property Type</label>
            <select
              value={form.propertyType}
              onChange={(e) => setForm({ ...form, propertyType: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            >
              {["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"].map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">BHK</label>
            <input
              type="number"
              min={1}
              max={10}
              value={form.bhk}
              onChange={(e) => setForm({ ...form, bhk: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">City *</label>
            <input
              required
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Locality *</label>
            <input
              required
              value={form.locality}
              onChange={(e) => setForm({ ...form, locality: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-white/50 mb-1.5">Address</label>
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
          />
        </div>
      </div>

      {/* Pricing & Size */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-white/80">Pricing & Size</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Min Price (₹) *</label>
            <input
              required
              type="number"
              min={0}
              value={form.priceMinInr}
              onChange={(e) => setForm({ ...form, priceMinInr: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Max Price (₹) *</label>
            <input
              required
              type="number"
              min={0}
              value={form.priceMaxInr}
              onChange={(e) => setForm({ ...form, priceMaxInr: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Area (sqft)</label>
            <input
              type="number"
              min={0}
              value={form.areaSqft}
              onChange={(e) => setForm({ ...form, areaSqft: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Floor</label>
            <input
              value={form.floor}
              onChange={(e) => setForm({ ...form, floor: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Furnishing</label>
            <select
              value={form.furnishing}
              onChange={(e) => setForm({ ...form, furnishing: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            >
              <option value="">Select...</option>
              {["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"].map((f) => (
                <option key={f} value={f}>{f.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Possession Date</label>
            <input
              value={form.possessionDate}
              onChange={(e) => setForm({ ...form, possessionDate: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Availability</label>
            <select
              value={form.availability}
              onChange={(e) => setForm({ ...form, availability: e.target.value })}
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
            >
              {["AVAILABLE", "LIMITED", "SOLD_OUT", "UPCOMING"].map((a) => (
                <option key={a} value={a}>{a.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={form.parking}
                onChange={(e) => setForm({ ...form, parking: e.target.checked })}
                className="rounded border-white/20 bg-white/5"
              />
              Parking Available
            </label>
          </div>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-white/50 mb-1.5">Description</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={4}
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
          placeholder="Describe the property..."
        />
      </div>

      {/* Amenities */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-white/50">Amenities</label>
          <button
            type="button"
            onClick={addAmenity}
            className="text-xs text-[#ffdf9e] hover:underline"
          >
            + Add Amenity
          </button>
        </div>
        <div className="space-y-2">
          {form.amenities.map((amenity, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={amenity}
                onChange={(e) => updateAmenity(idx, e.target.value)}
                placeholder="e.g., Swimming Pool"
                className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              />
              <button
                type="button"
                onClick={() => removeAmenity(idx)}
                className="p-2 rounded-lg text-white/40 hover:text-red-400 transition"
                aria-label="Remove amenity"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Media Upload */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-white/80">Media</h3>
        <PropertyMediaUpload
          propertyId={propertyId}
          organizationId={organizationId}
          initialImages={parseImages(property.imagesJson)}
          initialVideoUrl={property.videoUrl}
          initialVideoPosterUrl={property.videoPosterUrl}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm text-white/70 hover:bg-white/10 transition"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-[#d8a94e] px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#e5bc60] transition disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? "Saving..." : "Save Property"}
        </button>
      </div>
    </form>
  );
}
