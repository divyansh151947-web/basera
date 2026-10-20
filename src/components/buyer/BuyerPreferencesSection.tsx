"use client";

import { useState } from "react";
import { Save, Loader2, AlertCircle, CheckCircle, X } from "lucide-react";
import { Select } from "@/components/Select";

interface BuyerPreferences {
  budgetMinInr: number | null;
  budgetMaxInr: number | null;
  preferredCity: string | null;
  preferredLocality: string | null;
  propertyType: string | null;
  bhk: number | null;
  minAreaSqft: number | null;
  maxAreaSqft: number | null;
  furnishing: string | null;
  possessionTimeline: string | null;
  purpose: "BUY" | "RENT" | "INVEST" | null;
}

interface BuyerPreferencesSectionProps {
  initialPreferences: BuyerPreferences | null;
  userId: string;
}

const PROPERTY_TYPES = [
  { value: "", label: "Any Type" },
  { value: "APARTMENT", label: "Apartment / Flat" },
  { value: "VILLA", label: "Villa" },
  { value: "INDEPENDENT_HOUSE", label: "Independent House" },
  { value: "PLOT", label: "Plot / Land" },
  { value: "COMMERCIAL", label: "Commercial" },
] as const;

const FURNISHING_OPTIONS = [
  { value: "", label: "Any Furnishing" },
  { value: "UNFURNISHED", label: "Unfurnished" },
  { value: "SEMI_FURNISHED", label: "Semi Furnished" },
  { value: "FULLY_FURNISHED", label: "Fully Furnished" },
] as const;

const POSSESSION_OPTIONS = [
  { value: "", label: "Any Possession" },
  { value: "Ready to Move", label: "Ready to Move" },
  { value: "Under Construction", label: "Under Construction" },
  { value: "Upcoming", label: "Upcoming" },
] as const;

const PURPOSE_OPTIONS = [
  { value: "", label: "Any Purpose" },
  { value: "BUY", label: "Buy" },
  { value: "RENT", label: "Rent" },
  { value: "INVEST", label: "Invest" },
] as const;

const BHK_OPTIONS = [
  { value: "", label: "Any BHK" },
  { value: "1", label: "1 BHK" },
  { value: "2", label: "2 BHK" },
  { value: "3", label: "3 BHK" },
  { value: "4", label: "4 BHK" },
  { value: "5", label: "5+ BHK" },
] as const;

export function BuyerPreferencesSection({ initialPreferences, userId }: BuyerPreferencesSectionProps) {
  const [preferences, setPreferences] = useState<BuyerPreferences>({
    budgetMinInr: initialPreferences?.budgetMinInr ?? null,
    budgetMaxInr: initialPreferences?.budgetMaxInr ?? null,
    preferredCity: initialPreferences?.preferredCity ?? null,
    preferredLocality: initialPreferences?.preferredLocality ?? null,
    propertyType: initialPreferences?.propertyType ?? null,
    bhk: initialPreferences?.bhk ?? null,
    minAreaSqft: initialPreferences?.minAreaSqft ?? null,
    maxAreaSqft: initialPreferences?.maxAreaSqft ?? null,
    furnishing: initialPreferences?.furnishing ?? null,
    possessionTimeline: initialPreferences?.possessionTimeline ?? null,
    purpose: initialPreferences?.purpose ?? null,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleChange = (field: keyof BuyerPreferences, value: any) => {
    setPreferences(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    // Send every field, mapping cleared values ("") to null so that clearing a
    // preference actually persists (the API converts ""/null to a SQL NULL).
    const data: Record<string, any> = {};
    for (const key of Object.keys(preferences) as Array<keyof BuyerPreferences>) {
      const value = preferences[key];
      data[key] = value === "" || value === undefined ? null : value;
    }

    try {
      const res = await fetch("/api/buyer/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await res.json();
      if (res.ok) {
        setSuccess("Preferences saved successfully!");
      } else {
        setError(result.error || "Failed to save preferences");
      }
    } catch {
      setError("Failed to save preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = (field: keyof BuyerPreferences) => {
    setPreferences(prev => ({ ...prev, [field]: null }));
  };

  return (
    <div className="panel-surface p-5">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <span className="text-[#d8a94e]">⚙</span> Property Preferences
      </h2>
      <p className="text-sm text-white/50 mb-6">
        Set your preferences to get personalized property recommendations and better search results.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Min Budget (₹)</label>
            <div className="relative">
              <input
                type="number"
                value={preferences.budgetMinInr ?? ""}
                onChange={(e) => handleChange("budgetMinInr", e.target.value ? Number(e.target.value) : null)}
                min={0}
                step={100000}
                className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
                placeholder="e.g. 5000000"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Max Budget (₹)</label>
            <div className="relative">
              <input
                type="number"
                value={preferences.budgetMaxInr ?? ""}
                onChange={(e) => handleChange("budgetMaxInr", e.target.value ? Number(e.target.value) : null)}
                min={0}
                step={100000}
                className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
                placeholder="e.g. 10000000"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Preferred City</label>
            <input
              type="text"
              value={preferences.preferredCity ?? ""}
              onChange={(e) => handleChange("preferredCity", e.target.value || null)}
              className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
              placeholder="e.g. Jaipur, Noida, Gurgaon"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Preferred Locality</label>
            <input
              type="text"
              value={preferences.preferredLocality ?? ""}
              onChange={(e) => handleChange("preferredLocality", e.target.value || null)}
              className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
              placeholder="e.g. Sector 150, Sohna Road"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="pref-property-type" className="block text-sm font-medium text-white/60 mb-2">Property Type</label>
            <Select
              id="pref-property-type"
              aria-label="Property Type"
              showEmptyOption
              value={preferences.propertyType ?? ""}
              options={PROPERTY_TYPES}
              onChange={(v) => handleChange("propertyType", v || null)}
              placeholder="Any Type"
              className="w-full"
            />
          </div>
          <div>
            <label htmlFor="pref-bhk" className="block text-sm font-medium text-white/60 mb-2">BHK</label>
            <Select
              id="pref-bhk"
              aria-label="BHK"
              showEmptyOption
              value={preferences.bhk?.toString() ?? ""}
              options={BHK_OPTIONS}
              onChange={(v) => handleChange("bhk", v ? Number(v) : null)}
              placeholder="Any BHK"
              className="w-full"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Min Area (sq ft)</label>
            <input
              type="number"
              value={preferences.minAreaSqft ?? ""}
              onChange={(e) => handleChange("minAreaSqft", e.target.value ? Number(e.target.value) : null)}
              min={0}
              step={100}
              className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
              placeholder="e.g. 1000"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Max Area (sq ft)</label>
            <input
              type="number"
              value={preferences.maxAreaSqft ?? ""}
              onChange={(e) => handleChange("maxAreaSqft", e.target.value ? Number(e.target.value) : null)}
              min={0}
              step={100}
              className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
              placeholder="e.g. 3000"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="pref-furnishing" className="block text-sm font-medium text-white/60 mb-2">Furnishing</label>
            <Select
              id="pref-furnishing"
              aria-label="Furnishing"
              showEmptyOption
              value={preferences.furnishing ?? ""}
              options={FURNISHING_OPTIONS}
              onChange={(v) => handleChange("furnishing", v || null)}
              placeholder="Any Furnishing"
              className="w-full"
            />
          </div>
          <div>
            <label htmlFor="pref-possession" className="block text-sm font-medium text-white/60 mb-2">Possession Timeline</label>
            <Select
              id="pref-possession"
              aria-label="Possession Timeline"
              showEmptyOption
              value={preferences.possessionTimeline ?? ""}
              options={POSSESSION_OPTIONS}
              onChange={(v) => handleChange("possessionTimeline", v || null)}
              placeholder="Any Possession"
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label htmlFor="pref-purpose" className="block text-sm font-medium text-white/60 mb-2">Purpose</label>
          <Select
            id="pref-purpose"
            aria-label="Purpose"
            showEmptyOption
            value={preferences.purpose ?? ""}
            options={PURPOSE_OPTIONS}
            onChange={(v) => handleChange("purpose", (v || null) as BuyerPreferences["purpose"])}
            placeholder="Any Purpose"
            className="w-full"
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

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="primary-btn flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save size={18} /> Save Preferences
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setPreferences({
              budgetMinInr: null,
              budgetMaxInr: null,
              preferredCity: null,
              preferredLocality: null,
              propertyType: null,
              bhk: null,
              minAreaSqft: null,
              maxAreaSqft: null,
              furnishing: null,
              possessionTimeline: null,
              purpose: null,
            })}
            className="px-4 py-2.5 text-sm font-medium text-white/60 hover:text-white/80 transition"
          >
            Clear All
          </button>
        </div>
      </form>
    </div>
  );
}