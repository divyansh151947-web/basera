"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { X, ChevronRight, MapPin, BedDouble, Square, Building2 } from "lucide-react";

interface PublicProperty {
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
    imagesJson: string;
    amenitiesJson: string;
    parking: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
}

interface PropertyExplorerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ParsedProperty extends PublicProperty {
  coverImage: string | null;
}

const PROPERTY_TYPES = ["APARTMENT", "VILLA", "PLOT"] as const;
const CITIES = ["Noida", "Greater Noida", "Gurgaon"] as const;

function formatInr(amount: number): string {
  if (amount >= 10000000) {
    return "\u20B9" + (amount / 10000000).toFixed(1) + " Cr";
  }
  if (amount >= 100000) {
    return "\u20B9" + (amount / 100000).toFixed(1) + " L";
  }
  return "\u20B9" + amount.toLocaleString("en-IN");
}

// Parse images JSON once, memoized
function parseCoverImage(imagesJson: string): string | null {
  try {
    const parsed = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
  } catch {
    return null;
  }
}

// Memoized property card component to prevent re-renders
const PropertyCard = React.memo(function PropertyCard({ 
  property, 
  onClose, 
  formatInr 
}: { 
  property: ParsedProperty; 
  onClose: () => void;
  formatInr: (amount: number) => string;
}) {
  return (
    <Link
      key={property.property.id}
      href={"/explore/" + property.property.id}
      onClick={onClose}
      className="group flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-all hover:border-[#d8a94e]/30 hover:bg-white/[0.05]"
    >
      <div className="relative h-24 w-32 shrink-0 rounded-lg overflow-hidden bg-white/[0.02]">
        {property.coverImage ? (
          <Image
            src={property.coverImage}
            alt=""
            fill
            sizes="80px"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{
            backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px), linear-gradient(160deg, #16202f 0%, #101825 55%, #0f1f1a 100%)"
          }}>
            <Building2 size={24} className="text-white/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <span className="absolute bottom-2 left-2 rounded-full border border-success/30 bg-success-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-success">
          {property.property.availability?.replace("_", " ")}
        </span>
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <p className="font-medium text-white truncate">{property.property.projectName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-white/60">
            <MapPin size={10} className="text-[#ffdf9e]" />
            <span className="truncate">{property.property.locality}, {property.property.city}</span>
          </p>
          {property.property.developer && (
            <p className="mt-0.5 text-xs text-white/55 truncate">by {property.property.developer}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {property.property.bhk && (
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/80">
              {property.property.bhk} BHK
            </span>
          )}
          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/80 capitalize">
            {property.property.propertyType.toLowerCase()}
          </span>
          {property.property.areaSqft && (
            <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/80">
              {property.property.areaSqft.toLocaleString("en-IN")} sqft
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-display text-lg text-[#ffdf9e]">{formatInr(property.property.priceMinInr)}</span>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#ffdf9e]">
            View Details
            <ChevronRight size={12} />
          </span>
        </div>
      </div>
    </Link>
  );
});

export function PropertyExplorer({ isOpen, onClose }: PropertyExplorerProps) {
  const [properties, setProperties] = useState<ParsedProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    city: "",
    bhk: "",
    propertyType: "",
    maxPrice: "",
    minPrice: "",
    search: "",
  });

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.city) params.set("city", filters.city);
      if (filters.bhk) params.set("bhk", filters.bhk);
      if (filters.propertyType) params.set("propertyType", filters.propertyType);
      if (filters.maxPrice) params.set("maxPrice", filters.maxPrice);
      if (filters.minPrice) params.set("minPrice", filters.minPrice);
      if (filters.search) params.set("search", filters.search);

      const res = await fetch("/api/public/properties?" + params.toString());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load properties");
      
      // Parse cover images once when data arrives
      const parsedProperties: ParsedProperty[] = (data.properties || []).map((p: PublicProperty) => ({
        ...p,
        coverImage: parseCoverImage(p.property.imagesJson),
      }));
      
      setProperties(parsedProperties);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load properties");
      setProperties([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  function handleFilterChange(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters() {
    setFilters({ city: "", bhk: "", propertyType: "", maxPrice: "", minPrice: "", search: "" });
  }

  useEffect(() => {
    if (isOpen) {
      fetchProperties();
    }
  }, [isOpen, fetchProperties]);

  // Memoize formatInr to prevent recreation
  const formatInrMemo = useMemo(() => formatInr, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-auto">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-md lg:max-w-lg bg-[#0a0e16] border-l border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.5)] flex flex-col transition-transform duration-300 ease-out">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div>
            <h2 className="font-display text-xl text-white">Explore Properties</h2>
            <p className="text-sm text-white/50 mt-0.5">{properties.length} propert{properties.length !== 1 ? "ies" : "y"} found</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close property explorer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-white/10 space-y-4 max-h-[40vh] overflow-y-auto">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs font-medium text-[#ffdf9e] hover:underline"
            >
              Clear all filters
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50 mb-1 block">City</label>
              <select
                value={filters.city}
                onChange={(e) => handleFilterChange("city", e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              >
                <option value="">All Cities</option>
                {CITIES.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50 mb-1 block">BHK</label>
              <select
                value={filters.bhk}
                onChange={(e) => handleFilterChange("bhk", e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              >
                <option value="">Any BHK</option>
                <option value="1">1 BHK</option>
                <option value="2">2 BHK</option>
                <option value="3">3 BHK</option>
                <option value="4">4 BHK</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50 mb-1 block">Property Type</label>
              <select
                value={filters.propertyType}
                onChange={(e) => handleFilterChange("propertyType", e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              >
                <option value="">All Types</option>
                {PROPERTY_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50 mb-1 block">Min Price (\u20B9)</label>
                <input
                  type="number"
                  value={filters.minPrice}
                  onChange={(e) => handleFilterChange("minPrice", e.target.value)}
                  placeholder="e.g. 5000000"
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50 mb-1 block">Max Price (\u20B9)</label>
                <input
                  type="number"
                  value={filters.maxPrice}
                  onChange={(e) => handleFilterChange("maxPrice", e.target.value)}
                  placeholder="e.g. 15000000"
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50 mb-1 block">Search</label>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => handleFilterChange("search", e.target.value)}
                placeholder="Property name, developer..."
                className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15"
              />
            </div>
          </div>
        </div>

        {/* Property List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 w-full rounded-xl bg-white/[0.03] animate-pulse border border-white/5" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-4">
              <p className="text-white/60 mb-3">Unable to load properties</p>
              <p className="text-xs text-white/55 mb-4">{error}</p>
              <button
                onClick={fetchProperties}
                className="rounded-full border border-white/20 bg-transparent px-4 py-2 text-sm font-medium text-white/85 transition hover:border-white/50 hover:text-white"
              >
                Try Again
              </button>
            </div>
          ) : properties.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-4">
              <Building2 size={48} className="text-white/20 mb-3" />
              <p className="text-white/60 mb-2">No properties match your filters</p>
              <p className="text-sm text-white/55 mb-4">Try adjusting your search criteria</p>
              <button
                onClick={clearFilters}
                className="text-sm font-semibold text-[#ffdf9e] hover:underline"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            properties.map((property) => (
              <PropertyCard key={property.property.id} property={property} onClose={onClose} formatInr={formatInrMemo} />
            ))
          )}
        </div>

        {/* Footer CTA */}
        <div className="p-4 border-t border-white/10 bg-black/20">
          <p className="text-center text-xs text-white/55 mb-3">
            Powered by Basera \u00B7 Data from verified partner agencies
          </p>
          <Link
            href="/explore"
            onClick={onClose}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#0a0e16] transition hover:bg-white/90"
          >
            View All Properties
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}