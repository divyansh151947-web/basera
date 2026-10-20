"use client";

import Link from "next/link";
import Image from "next/image";
import { MapPin, Building2, BedDouble, Clock, ArrowRight } from "lucide-react";
import { formatInr, formatDisplayDate } from "@/lib/formatters";

interface RecentlyViewedProperty {
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
  viewedAt: string;
}

interface RecentlyViewedSectionProps {
  properties: RecentlyViewedProperty[];
}

function parseCoverImage(imagesJson: string | null | undefined): string | null {
  try {
    const list = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
  } catch {
    return null;
  }
}

export function RecentlyViewedSection({ properties }: RecentlyViewedSectionProps) {
  if (properties.length === 0) {
    return (
      <div className="panel-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Recently Viewed</h2>
        </div>
        <div className="text-center py-8 text-white/50">
          <Clock size={32} className="mx-auto text-white/20" />
          <p className="mt-3 text-lg">No recently viewed properties</p>
          <p className="mt-1 text-sm">Properties you view will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-surface p-5">
      <h2 className="text-lg font-semibold text-white mb-4">Recently Viewed</h2>
      <div className="space-y-3">
        {properties.map(({ property, organization }) => {
          const cover = parseCoverImage(property.imagesJson);
          return (
            <Link
              key={property.id}
              href={`/explore/${property.id}`}
              className="group flex gap-3 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-[#d8a94e]/30 hover:bg-white/10"
            >
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
                    <Building2 size={20} className="text-white/20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <span className="absolute bottom-1.5 left-1.5 right-1.5 rounded-full border border-white/20 bg-black/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-white/80 backdrop-blur-sm">
                  {property.propertyType.replace("_", " ")}
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
                    {formatDisplayDate(new Date())}
                  </span>
                </div>
                
                <div className="mt-2 flex items-end justify-between">
                  <p className="text-lg font-semibold text-[#ffdf9e]">{formatInr(property.priceMinInr)}</p>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[#ffdf9e]">
                    View <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}