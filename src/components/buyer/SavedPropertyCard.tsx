"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Building2, ArrowRight, AlertCircle, X } from "lucide-react";
import { formatInr, formatDisplayDate } from "@/lib/formatters";

interface SavedPropertyCardProps {
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
  userId: string;
  cover: string | null;
}

export function SavedPropertyCard({ 
  property, 
  organization, 
  savedAt,
  userId,
  cover
}: SavedPropertyCardProps) {
  const router = useRouter();
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [unsaveLoading, setUnsaveLoading] = useState(false);
  const [unsaveError, setUnsaveError] = useState("");
  const [removed, setRemoved] = useState(false);

  const handleUnsave = async () => {
    if (unsaveLoading) return;
    setUnsaveLoading(true);
    setUnsaveError("");
    try {
      // DELETE carries the id in the query string (route contract).
      const res = await fetch(`/api/buyer/saved?propertyId=${encodeURIComponent(property.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove saved property");
      }
      // Drop the card from the list immediately, then refresh the server
      // components so the saved count / empty state stay truthful.
      setRemoved(true);
      router.refresh();
    } catch (err) {
      setUnsaveError(err instanceof Error ? err.message : "Failed to remove saved property");
    } finally {
      setUnsaveLoading(false);
    }
  };

  if (removed) return null;

  return (
    <div
      key={property.id}
      className="group relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.04] shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-[#d8a94e]/30"
    >
      {/* Stretched link: the whole card navigates, while the remove button
          stays a sibling (no button nested inside an anchor). */}
      <Link
        href={`/explore/${property.id}`}
        className="absolute inset-0 z-10"
        aria-label={`View ${property.projectName}`}
      />
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

        <button
          type="button"
          onClick={handleUnsave}
          disabled={unsaveLoading}
          className="pointer-events-auto absolute top-3 right-3 z-20 rounded-full p-2 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition disabled:opacity-50"
          aria-label={`Remove ${property.projectName} from saved`}
        >
          <X size={18} className={unsaveLoading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="relative p-5">
        {unsaveError && (
          <p role="alert" className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle size={14} className="shrink-0" /> {unsaveError}
          </p>
        )}
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
        <p className="mt-2 text-xs text-white/55">Listed by {organization.name} · Saved {formatDisplayDate(savedAt)}</p>
      </div>
    </div>
  );
}