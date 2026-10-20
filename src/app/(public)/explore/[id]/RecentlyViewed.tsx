"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { MapPin, BedDouble, Square, Building2, ArrowRight, Clock, X } from "lucide-react";
import { formatInr, formatDisplayDate } from "@/lib/formatters";

interface RecentlyViewedProperty {
  id: string;
  projectName: string;
  city: string;
  locality: string;
  priceMinInr: number;
  priceMaxInr: number;
  areaSqft: number | null;
  bhk: number | null;
  propertyType: string;
  availability: string;
  imagesJson: string;
  viewedAt: string;
}

const STORAGE_KEY = "basera_recently_viewed";
const MAX_RECENT = 5;

function parseCoverImage(imagesJson: string | null | undefined): string | null {
  try {
    const list = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
  } catch {
    return null;
  }
}

function getRecentlyViewed(): RecentlyViewedProperty[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentlyViewed(properties: RecentlyViewedProperty[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(properties));
  } catch {
    // Ignore storage errors
  }
}

export function RecentlyViewed({ currentPropertyId }: { currentPropertyId: string }) {
  const [recentProperties, setRecentProperties] = useState<RecentlyViewedProperty[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = getRecentlyViewed();
    // Filter out current property
    const filtered = stored.filter(p => p.id !== currentPropertyId);
    setRecentProperties(filtered);
  }, [currentPropertyId]);

  const addToRecent = useCallback((property: Omit<RecentlyViewedProperty, "viewedAt">) => {
    setRecentProperties(prev => {
      const filtered = prev.filter(p => p.id !== property.id);
      const updated = [
        { ...property, viewedAt: new Date().toISOString() },
        ...filtered,
      ].slice(0, MAX_RECENT);
      saveRecentlyViewed(updated);
      return updated;
    });
  }, []);

  const removeFromRecent = useCallback((id: string) => {
    setRecentProperties(prev => {
      const updated = prev.filter(p => p.id !== id);
      saveRecentlyViewed(updated);
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    setRecentProperties([]);
    saveRecentlyViewed([]);
  }, []);

  if (!mounted || recentProperties.length === 0) return null;

  return (
    <div className="panel-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">Recently Viewed</h2>
        <button
          onClick={clearAll}
          className="text-xs text-white/50 hover:text-white/70 flex items-center gap-1"
        >
          <X size={12} /> Clear
        </button>
      </div>

      <div className="space-y-3">
        {recentProperties.map((property) => (
          <Link
            key={property.id}
            href={`/explore/${property.id}`}
            className="group flex gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-[#d8a94e]/30 hover:bg-white/10"
            onClick={() => addToRecent(property)}
          >
            <div className="relative h-20 w-28 flex-shrink-0 rounded-lg overflow-hidden">
              {parseCoverImage(property.imagesJson) ? (
                <Image
                  src={parseCoverImage(property.imagesJson)!}
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
                  <Building2 size={20} className="text-white/20" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <span className="absolute bottom-1.5 left-1.5 right-1.5 rounded-full border border-success/30 bg-success-soft px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.1em] text-success">
                {property.availability?.replace("_", " ")}
              </span>
            </div>
            
            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div>
                <p className="font-medium text-white truncate group-hover:text-[#ffdf9e] transition-colors">{property.projectName}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60">
                  <MapPin size={12} className="text-[#ffdf9e]" />
                  <span className="truncate">{property.locality}, {property.city}</span>
                </p>
              </div>
              
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {property.bhk && <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70">{property.bhk} BHK</span>}
                {property.areaSqft && <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70">{property.areaSqft.toLocaleString("en-IN")} sqft</span>}
                <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70 flex items-center gap-1">
                  <Clock size={10} />
                  {formatDisplayDate(property.viewedAt)}
                </span>
              </div>
              
              <div className="mt-2 flex items-end justify-between">
                <p className="text-lg font-semibold text-[#ffdf9e]">{formatInr(property.priceMinInr)}</p>
                <span className="inline-flex items-center gap-1 text-sm font-medium text-[#ffdf9e]">
                  View <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </div>
            
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                removeFromRecent(property.id);
              }}
              className="flex-shrink-0 mt-auto mb-2 rounded-full bg-white/10 p-1.5 text-white/50 hover:bg-white/20 hover:text-white transition opacity-0 group-hover:opacity-100"
              aria-label={`Remove ${property.projectName} from recently viewed`}
            >
              <X size={14} />
            </button>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Client-side hook to track property views
export function useTrackPropertyView(property: Omit<RecentlyViewedProperty, "viewedAt">) {
  const propertyRef = useRef(property);
  propertyRef.current = property;
  
  useEffect(() => {
    const stored = getRecentlyViewed();
    const filtered = stored.filter(p => p.id !== propertyRef.current.id);
    const updated = [
      { ...propertyRef.current, viewedAt: new Date().toISOString() },
      ...filtered,
    ].slice(0, MAX_RECENT);
    saveRecentlyViewed(updated);
  }, [propertyRef.current.id]);
}