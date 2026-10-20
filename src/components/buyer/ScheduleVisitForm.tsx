"use client";

import { useState, useEffect, useMemo } from "react";
import { CalendarClock, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { Select } from "@/components/Select";
import { buildVisitPropertyOptions } from "@/lib/visit-options";

interface PropertyOption {
  id: string;
  projectName: string;
  city: string;
  locality: string;
  priceMinInr: number;
}

interface ScheduleVisitFormProps {
  userId: string;
}

export function ScheduleVisitForm({ userId }: ScheduleVisitFormProps) {
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [selectedProperty, setSelectedProperty] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const propertyOptions = useMemo(() => buildVisitPropertyOptions(properties), [properties]);

  const fetchProperties = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/public/properties");
      if (res.ok) {
        const data = await res.json();
        setProperties(data.properties.map(({ property }: { property: any }) => ({
          id: property.id,
          projectName: property.projectName,
          city: property.city,
          locality: property.locality,
          priceMinInr: property.priceMinInr,
        })));
      }
    } catch {
      // Ignore errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProperties();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProperty || !scheduledAt) {
      setError("Please select a property and date/time");
      return;
    }

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate <= new Date()) {
      setError("Scheduled date must be in the future");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/buyer/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: selectedProperty, scheduledAt, notes }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess("Visit request submitted successfully! You'll receive a confirmation soon.");
        setSelectedProperty("");
        setScheduledAt("");
        setNotes("");
      } else {
        setError(data.error || "Failed to submit visit request");
      }
    } catch {
      setError("Failed to submit visit request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-white/60 mb-2">Property</label>
        {loading ? (
          <div className="flex items-center gap-2 text-white/50">
            <Loader2 size={16} className="animate-spin" />
            Loading properties...
          </div>
        ) : (
          <Select
            value={selectedProperty}
            onChange={setSelectedProperty}
            options={propertyOptions}
            placeholder="Select a property"
            aria-label="Property"
          />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-white/60 mb-2">Preferred Date & Time</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
            className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-white/60 mb-2">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full appearance-none rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
          placeholder="Any specific requirements or questions for the visit..."
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

      <button
        type="submit"
        disabled={submitting || !selectedProperty || !scheduledAt}
        className="primary-btn w-full disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <>
            <Loader2 size={18} className="animate-spin mr-2" />
            Submitting...
          </>
        ) : (
          "Submit Visit Request"
        )}
      </button>
    </form>
  );
}