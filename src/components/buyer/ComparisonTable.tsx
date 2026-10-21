"use client";

import { useState } from "react";
import Link from "next/link";
import { MapPin, Building2, Scale, ArrowRight, X, Trash2, Plus } from "lucide-react";
import { formatInr } from "@/lib/formatters";

interface ComparisonTableProps {
  properties: Array<{
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
  }>;
  comparisonId: string | undefined;
  userId: string;
}

function parseAmenities(amenitiesJson: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(amenitiesJson ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ComparisonTable({ properties, comparisonId, userId }: ComparisonTableProps) {
  const [removeLoading, setRemoveLoading] = useState<string | null>(null);

  const comparisonFields = [
    { key: "projectName", label: "Property Name", type: "text" as const },
    { key: "developer", label: "Developer", type: "text" as const },
    { key: "propertyType", label: "Property Type", type: "text" as const, transform: (v: string) => v.replace("_", " ") },
    { key: "bhk", label: "BHK", type: "bhk" as const },
    { key: "city", label: "City", type: "text" as const },
    { key: "locality", label: "Locality", type: "text" as const },
    { key: "address", label: "Address", type: "text" as const },
    { key: "priceMinInr", label: "Starting Price", type: "price" as const },
    { key: "priceMaxInr", label: "Max Price", type: "price" as const },
    { key: "areaSqft", label: "Area (sq ft)", type: "area" as const },
    { key: "pricePerSqft", label: "Price / sq ft", type: "pricePerSqft" as const },
    { key: "floor", label: "Floor", type: "text" as const },
    { key: "furnishing", label: "Furnishing", type: "furnishing" as const },
    { key: "possessionDate", label: "Possession", type: "text" as const },
    { key: "availability", label: "Availability", type: "availability" as const },
    { key: "parking", label: "Parking", type: "parking" as const },
    { key: "amenities", label: "Amenities", type: "amenities" as const },
    { key: "organization", label: "Listed By", type: "organization" as const },
  ];

  const getFieldValue = (prop: any, field: string) => {
    switch (field) {
      case "pricePerSqft":
        return prop.areaSqft && prop.priceMinInr ? Math.round(prop.priceMinInr / prop.areaSqft) : null;
      case "amenities":
        return parseAmenities(prop.amenitiesJson);
      case "organization":
        return prop.organization?.name;
      case "availability":
        return prop.availability?.replace("_", " ");
      case "furnishing":
        return prop.furnishing?.replace("_", " ").toLowerCase();
      case "propertyType":
        return prop.propertyType?.replace("_", " ");
      default:
        return prop[field];
    }
  };

  // Helper to check if values differ across properties
  const hasDifference = (fieldKey: string) => {
    const values = properties.map(p => getFieldValue(p.property, fieldKey));
    const filtered = values.filter(v => v != null && v !== "");
    if (filtered.length <= 1) return false;
    return new Set(filtered.map(v => String(v))).size > 1;
  };

  const formatValue = (value: any, type: string, highlight: boolean = false) => {
    if (value == null) return <span className="text-white/30">—</span>;
    switch (type) {
      case "price":
        return <span className={highlight ? "font-bold text-[#ffdf9e]" : ""}>{formatInr(value)}</span>;
      case "area":
        return <span className={highlight ? "font-bold text-[#ffdf9e]" : ""}>{`${value.toLocaleString("en-IN")} sq ft`}</span>;
      case "pricePerSqft":
        return <span className={highlight ? "font-bold text-[#ffdf9e]" : ""}>{formatInr(value) + " / sq ft"}</span>;
      case "bhk":
        return <span className={highlight ? "font-bold text-[#ffdf9e]" : ""}>{`${value} BHK`}</span>;
      case "parking":
        return <span className={highlight ? "font-bold text-[#ffdf9e]" : ""}>{value ? "Available" : "Not available"}</span>;
      case "amenities":
        if (Array.isArray(value) && value.length > 0) {
          return (
            <div className="flex flex-wrap gap-1">
              {value.map((a: string) => (
                <span key={a} className={`rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-white/70 ${highlight ? "border-[#d8a94e] bg-[#d8a94e]/10" : ""}`}>{a}</span>
              ))}
            </div>
          );
        }
        return <span className="text-white/30">—</span>;
      default:
        return <span className={highlight ? "font-bold text-[#ffdf9e]" : ""}>{String(value)}</span>;
    }
  };

  const handleRemove = async (propertyId: string) => {
    if (!comparisonId) return;
    if (removeLoading) return;
    setRemoveLoading(propertyId);
    try {
      const res = await fetch(`/api/buyer/comparisons/${comparisonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          propertyIds: properties.filter(p => p.property.id !== propertyId).map(p => p.property.id) 
        }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to remove property");
      }
    } catch {
      alert("Failed to remove property");
    } finally {
      setRemoveLoading(null);
    }
  };

  return (
    <div className="panel-surface overflow-hidden">
      <div className="p-5 border-b border-white/10">
        {/* flex-wrap: at 320px the title + right group min-content (~267px)
            exceed the ~176px panel content (buyer rail + padding), and
            overflow-hidden clipped the Delete button past the viewport. The
            right group now drops to its own line there; ≥390px keeps the
            original single-line layout. */}
        <div className="flex flex-wrap items-center justify-between gap-y-1">
          <h2 className="text-lg font-semibold text-white">Property Comparison</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/50">{properties.length} of 5 properties</span>
            {comparisonId && (
              <button
                onClick={() => {
                  if (confirm("Delete this comparison?")) {
                    fetch(`/api/buyer/comparisons/${comparisonId}`, { method: "DELETE" })
                      .then(() => window.location.reload());
                  }
                }}
                className="text-sm text-white/50 hover:text-white/70 flex items-center gap-1"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className="w-64 px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Attribute</th>
              {properties.map(({ property, organization }) => (
                <th key={property.id} className="px-5 py-4 text-left">
                  <div className="flex items-center gap-2">
                    <Link href={`/explore/${property.id}`} className="flex-1">
                      <p className="font-medium text-white truncate group-hover:text-[#ffdf9e] transition-colors">{property.projectName}</p>
                      <p className="text-sm text-white/50 truncate">{property.locality}, {property.city}</p>
                    </Link>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRemove(property.id); }}
                      disabled={removeLoading === property.id}
                      className="p-1.5 rounded-full bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition disabled:opacity-50"
                      aria-label={`Remove ${property.projectName}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </th>
              ))}
              {properties.length < 5 && (
                <th className="px-5 py-4 text-left">
                  <Link href="/buyer/explore" className="flex flex-col items-center justify-center gap-2 h-32 border-2 border-dashed border-white/10 rounded-xl text-white/55 hover:border-[#d8a94e]/50 hover:text-white/70 transition">
                    <Plus size={24} />
                    <span className="text-sm font-medium">Add Property</span>
                  </Link>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {comparisonFields.map((field) => {
              const highlight = hasDifference(field.key);
              return (
                <tr key={field.key} className="border-b border-white/5">
                  <td className="w-64 px-5 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-white/60">
                    <span className={`flex items-center gap-1.5 ${highlight ? "text-[#d8a94e]" : "text-white/60"}`}>
                      {field.label}
                      {highlight && <span className="text-xs text-[#d8a94e]" title="Values differ across properties">●</span>}
                    </span>
                  </td>
                    {properties.map(({ property, organization }) => (
                      <td key={property.id} className="px-5 py-3">
                        {formatValue(getFieldValue(property, field.key), field.type, highlight)}
                      </td>
                    ))}
                    {properties.length < 5 && (
                      <td className="px-5 py-3 text-center text-white/30">—</td>
                    )}
                  </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}