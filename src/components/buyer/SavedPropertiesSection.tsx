"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Building2, BedDouble, Heart, ArrowRight, X, AlertCircle } from "lucide-react";
import { formatInr } from "@/lib/formatters";

interface SavedProperty {
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
    parking: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  savedAt: string;
}

interface SavedPropertiesSectionProps {
  properties: SavedProperty[];
  userId: string;
}

function parseCoverImage(imagesJson: string | null | undefined): string | null {
  try {
    const list = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
  } catch {
    return null;
  }
}

export function SavedPropertiesSection({ properties, userId }: SavedPropertiesSectionProps) {
  const [savedProps, setSavedProps] = useState<SavedProperty[]>(properties);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const handleUnsave = async (propertyId: string) => {
    if (removingId) return;
    setRemovingId(propertyId);
    setError("");
    const previous = savedProps;
    // Optimistic removal, rolled back if the API rejects the delete.
    setSavedProps(prev => prev.filter(p => p.property.id !== propertyId));
    try {
      const res = await fetch(`/api/buyer/saved?propertyId=${encodeURIComponent(propertyId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove saved property");
      }
    } catch (err) {
      setSavedProps(previous);
      setError(err instanceof Error ? err.message : "Failed to remove saved property");
    } finally {
      setRemovingId(null);
    }
  };

  if (savedProps.length === 0) {
    return (
      <div className="panel-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Saved Properties</h2>
          <Link href="/buyer/saved" className="text-sm font-medium text-[#d8a94e] hover:underline">View all</Link>
        </div>
        <div className="text-center py-8 text-white/50">
          <Heart size={32} className="mx-auto text-white/20" />
          <p className="mt-3 text-lg">No saved properties yet</p>
          <p className="mt-1 text-sm">Start exploring and save properties you like</p>
          <Link href="/explore" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#d8a94e] hover:underline">
            Explore properties <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Saved Properties</h2>
        <Link href="/buyer/saved" className="text-sm font-medium text-[#d8a94e] hover:underline">View all</Link>
      </div>
      <div className="space-y-3">
        {error && (
          <div role="alert" className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl p-3">
            <AlertCircle size={16} /> {error}
          </div>
        )}
        {savedProps.map(({ property, organization, savedAt }) => {
          const cover = parseCoverImage(property.imagesJson);
          const isRemoving = removingId === property.id;
          return (
            <div
              key={property.id}
              className="group relative flex gap-4 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-[#d8a94e]/30 hover:bg-white/10"
            >
              <Link
                href={`/explore/${property.id}`}
                className="absolute inset-0 z-10 rounded-xl"
                aria-label={`View ${property.projectName}`}
              >
                <span className="sr-only">View {property.projectName}</span>
              </Link>
              <div className="relative h-20 w-28 flex-shrink-0 rounded-lg overflow-hidden">
                {cover ? (
                  <Image
                    src={cover}
                    alt=""
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="112px"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center" style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px), linear-gradient(160deg, #16202f 0%, #101825 55%, #0f1f1a 100%)",
                  }}>
                    <Building2 size={24} className="text-white/20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              </div>
              <div className="min-w-0 flex-1 pointer-events-none select-none" aria-hidden>
                <p className="font-medium text-white truncate">{property.projectName}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60">
                  <MapPin size={12} className="text-[#ffdf9e]" />
                  <span className="truncate">{property.locality}, {property.city}</span>
                </p>
                {property.developer && (
                  <p className="mt-1 text-xs text-white/55 truncate">by {property.developer}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {property.bhk && <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70">{property.bhk} BHK</span>}
                  {property.areaSqft && <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70">{property.areaSqft.toLocaleString("en-IN")} sqft</span>}
                </div>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                  <p className="text-lg font-semibold text-[#ffdf9e]">{formatInr(property.priceMinInr)}</p>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[#ffdf9e]">
                    View <ArrowRight size={12} />
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleUnsave(property.id)}
                disabled={isRemoving}
                className="pointer-events-auto absolute right-2.5 top-2.5 z-20 rounded-full bg-white/10 p-1.5 text-white/60 hover:bg-white/20 hover:text-white transition disabled:opacity-50"
                aria-label={`Remove ${property.projectName} from saved`}
              >
                <X size={14} className={isRemoving ? "animate-spin" : ""} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}