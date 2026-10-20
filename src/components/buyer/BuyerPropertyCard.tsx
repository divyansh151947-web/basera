"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Building2, ArrowRight, Heart, Scale, Heart as HeartFilled, Scale as ScaleFilled } from "lucide-react";
import { formatInr } from "@/lib/formatters";

interface BuyerPropertyCardProps {
  property: {
    id: string;
    projectName: string;
    developer: string | null;
    propertyType: string;
    bhk: number | null;
    city: string;
    locality: string;
    priceMinInr: number;
    priceMaxInr: number;
    areaSqft: number | null;
    floor: string | null;
    furnishing: string | null;
    possessionDate: string | null;
    availability: string;
    description: string | null;
    imagesJson: string | null;
    amenitiesJson: string | null;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  cover: string | null;
  isSaved: boolean;
  isCompared: boolean;
  userId: string;
}

export function BuyerPropertyCard({ 
  property, 
  organization, 
  cover,
  isSaved: initialSaved,
  isCompared: initialCompared,
  userId
}: BuyerPropertyCardProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [isCompared, setIsCompared] = useState(initialCompared);
  const [saveLoading, setSaveLoading] = useState(false);
  const [compareLoading, setCompareLoading] = useState(false);

  // First-click staging: the API requires at least 2 properties per
  // comparison, so a lone first pick is staged in localStorage until a
  // second property is chosen (then both are created together).
  const COMPARE_PENDING_KEY = "basera:compare-pending";

  function readStagedCompareIds(): string[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(COMPARE_PENDING_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
    } catch {
      return [];
    }
  }

  function writeStagedCompareIds(ids: string[]): void {
    try {
      localStorage.setItem(COMPARE_PENDING_KEY, JSON.stringify(ids));
    } catch {
      // storage unavailable — the second pick simply starts a new staging
    }
  }
  const handleSave = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (saveLoading) return;
    setSaveLoading(true);
    try {
      // DELETE carries the id in the query string (route contract);
      // POST carries it in the JSON body.
      const res = await fetch(
        isSaved ? `/api/buyer/saved?propertyId=${encodeURIComponent(property.id)}` : "/api/buyer/saved",
        {
          method: isSaved ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: isSaved ? undefined : JSON.stringify({ propertyId: property.id }),
        }
      );
      if (res.ok) {
        setIsSaved(!isSaved);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to update saved property");
      }
    } catch {
      alert("Failed to update saved property");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleCompare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (compareLoading) return;
    setCompareLoading(true);
    try {
      const res = await fetch("/api/buyer/comparisons");
      if (!res.ok) throw new Error("Failed to fetch comparisons");
      const data = await res.json();
      let comparison = data.comparisons?.[0];
      
      if (!comparison) {
        const staged = readStagedCompareIds().filter((id) => id !== property.id);
        const ids = [...staged, property.id];
        if (ids.length < 2) {
          writeStagedCompareIds(ids);
          alert("Saved! Select one more property to start comparing.");
          return;
        }
        try {
          localStorage.removeItem(COMPARE_PENDING_KEY);
        } catch {
          // storage unavailable — continue with the in-memory ids
        }
        const createRes = await fetch("/api/buyer/comparisons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Comparison", propertyIds: ids }),
        });
        if (createRes.ok) {
          setIsCompared(true);
        } else {
          const err = await createRes.json().catch(() => ({}));
          alert(err.error || "Failed to add to comparison");
        }
      } else {
        const propertyIds = JSON.parse(comparison.propertyIds) as string[];
        if (propertyIds.includes(property.id)) {
          const newIds = propertyIds.filter((id: string) => id !== property.id);
          const updateRes = await fetch(`/api/buyer/comparisons/${comparison.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ propertyIds: newIds }),
          });
          if (updateRes.ok) {
            setIsCompared(false);
          }
        } else {
          if (propertyIds.length >= 5) {
            alert("Maximum 5 properties can be compared at once");
            setCompareLoading(false);
            return;
          }
          const newIds = [...propertyIds, property.id];
          const updateRes = await fetch(`/api/buyer/comparisons/${comparison.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ propertyIds: newIds }),
          });
          if (updateRes.ok) {
            setIsCompared(true);
          }
        }
      }
    } catch {
      alert("Failed to update comparison");
    } finally {
      setCompareLoading(false);
    }
  };

  return (
    <Link
      key={property.id}
      href={`/explore/${property.id}`}
      className="group overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.04] shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#d8a94e]/30"
    >
      <div className="relative h-56 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px), linear-gradient(160deg, #16202f 0%, #101825 55%, #0f1f1a 100%)",
          }}
          aria-hidden
        />
        {cover && !imageError && (
          <Image
            src={cover}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 33vw"
            className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${imageLoading ? "opacity-0" : "opacity-100"}`}
            loading="lazy"
            onLoad={() => setImageLoading(false)}
            onError={() => { setImageError(true); setImageLoading(false); }}
          />
        )}
        {(imageError || !cover) && (
          <div className="absolute inset-0 flex items-center justify-center" style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px), linear-gradient(160deg, #16202f 0%, #101825 55%, #0f1f1a 100%)",
          }}>
            <Building2 size={48} className="text-white/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/35" aria-hidden />

        <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-2">
          <span className="rounded-full border border-white/25 bg-black/35 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur-sm">
            {property.propertyType.replace("_", " ")}
          </span>
          <span className="rounded-full border border-success/30 bg-success-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-success">
            {property.availability?.replace("_", " ")}
          </span>
        </div>

        <div className="absolute inset-x-4 bottom-4">
          <p className="font-display text-xl leading-tight text-white">{property.projectName}</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-white/70">
            <MapPin size={14} className="text-[#ffdf9e]" />
            <span>{property.locality}, {property.city}</span>
          </p>
        </div>

        <div className="absolute top-3 right-3 flex gap-1.5">
          <button
            onClick={handleSave}
            disabled={saveLoading}
            className={`rounded-full p-2 transition ${isSaved ? "bg-[#ef4444]/90 text-white" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
            aria-label={isSaved ? "Remove from saved" : "Save property"}
            aria-pressed={isSaved}
          >
            {isSaved ? <HeartFilled size={18} /> : <Heart size={18} />}
          </button>
          <button
            onClick={handleCompare}
            disabled={compareLoading}
            className={`rounded-full p-2 transition ${isCompared ? "bg-[#3b82f6]/90 text-white" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
            aria-label={isCompared ? "Remove from comparison" : "Add to comparison"}
            aria-pressed={isCompared}
          >
            {isCompared ? <ScaleFilled size={18} /> : <Scale size={18} />}
          </button>
        </div>
      </div>

      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          {property.bhk && <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/80">{property.bhk} BHK</span>}
          {property.furnishing && <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/80">{property.furnishing.replace("_", " ").toLowerCase()}</span>}
          {property.areaSqft && <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/80">{property.areaSqft.toLocaleString("en-IN")} sqft</span>}
        </div>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-white/10 pt-4 transition-colors group-hover:border-[#d8a94e]/30">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Starting at</p>
            <p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-[#ffdf9e]">{formatInr(property.priceMinInr)}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#ffdf9e]">
            View details
            <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </span>
        </div>

        {property.developer && <p className="mt-3 truncate text-sm text-white/50">by {property.developer}</p>}
        <p className="mt-2 text-xs text-white/55">Listed by {organization.name}</p>
      </div>
    </Link>
  );
}