"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, BedDouble, Square, Building2, ArrowRight } from "lucide-react";
import { formatInr } from "@/lib/formatters";

interface SimilarProperty {
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
}

interface SimilarPropertiesProps {
  properties: SimilarProperty[];
  currentPropertyId: string;
}

function parseCoverImage(imagesJson: string | null | undefined): string | null {
  try {
    const list = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
  } catch {
    return null;
  }
}

export function SimilarProperties({ properties, currentPropertyId }: SimilarPropertiesProps) {
  if (properties.length === 0) return null;

  return (
    <div className="panel-surface p-5 space-y-4">
      <h2 className="font-semibold text-white">Similar Properties</h2>
      <p className="text-sm text-white/50">Properties in the same area with similar specifications</p>
      
      <div className="grid gap-4 sm:grid-cols-2">
        {properties.map(({ property, organization }) => {
          const cover = parseCoverImage(property.imagesJson);
          return (
            <Link
              key={property.id}
              href={`/explore/${property.id}`}
              className="group flex min-w-0 gap-4 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-[#d8a94e]/30 hover:bg-white/10"
            >
              <div className="relative h-24 w-32 flex-shrink-0 rounded-lg overflow-hidden">
                {cover ? (
                  <Image
                    src={cover}
                    alt=""
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="128px"
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
                <div className="absolute bottom-2 left-2 right-2 flex justify-between">
                  <span className="rounded-full border border-white/20 bg-black/40 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-white/80 backdrop-blur-sm">
                    {property.propertyType.replace("_", " ")}
                  </span>
                  <span className="rounded-full border border-success/30 bg-success-soft px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-success">
                    {property.availability?.replace("_", " ")}
                  </span>
                </div>
              </div>
              
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <p className="font-medium text-white truncate group-hover:text-[#ffdf9e] transition-colors">{property.projectName}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60">
                    <MapPin size={12} className="text-[#ffdf9e]" />
                    <span className="truncate">{property.locality}, {property.city}</span>
                  </p>
                  {property.developer && (
                    <p className="mt-1 text-xs text-white/55 truncate">by {property.developer}</p>
                  )}
                </div>
                
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {property.bhk && <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70">{property.bhk} BHK</span>}
                  {property.areaSqft && <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70">{property.areaSqft.toLocaleString("en-IN")} sqft</span>}
                </div>
                
                <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.1em] text-white/60">Starting at</p>
                    <p className="text-lg font-semibold text-[#ffdf9e]">{formatInr(property.priceMinInr)}</p>
                  </div>
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