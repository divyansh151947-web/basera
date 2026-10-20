"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Building2, CalendarClock, Clock, CheckCircle, AlertCircle, X, Trash2, Loader2, Link as LinkIcon } from "lucide-react";
import { formatInr, formatDisplayDateTime } from "@/lib/formatters";

interface VisitListProps {
  title: string;
  visits: Array<{
    id: string;
    propertyId: string;
    scheduledAt: string;
    status: string;
    notes: string | null;
    createdAt: string;
    property: {
      id: string;
      projectName: string;
      city: string;
      locality: string;
      priceMinInr: number;
      propertyType: string;
      bhk: number | null;
      imagesJson: string | null;
    } | null;
  }>;
  showActions: boolean;
}

function parseCoverImage(imagesJson: string | null | undefined): string | null {
  try {
    const list = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
  } catch {
    return null;
  }
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  SCHEDULED: { bg: "bg-blue-500/20", text: "text-blue-400", icon: Clock },
  CONFIRMED: { bg: "bg-green-500/20", text: "text-green-400", icon: CheckCircle },
  COMPLETED: { bg: "bg-gray-500/20", text: "text-gray-400", icon: CheckCircle },
  CANCELED: { bg: "bg-red-500/20", text: "text-red-400", icon: X },
  NO_SHOW: { bg: "bg-orange-500/20", text: "text-orange-400", icon: AlertCircle },
  REQUESTED: { bg: "bg-yellow-500/20", text: "text-yellow-400", icon: Clock },
};

export function VisitList({ title, visits, showActions }: VisitListProps) {
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);

  const handleCancel = async (visitId: string) => {
    if (cancelLoading) return;
    if (!confirm("Are you sure you want to cancel this visit request?")) return;
    setCancelLoading(visitId);
    try {
      const res = await fetch(`/api/buyer/visits/${visitId}`, { method: "DELETE" });
      if (res.ok) {
        window.location.reload();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Failed to cancel visit request");
      }
    } catch {
      alert("Failed to cancel visit request");
    } finally {
      setCancelLoading(null);
    }
  };

  return (
    <div className="panel-surface p-5">
      <h2 className="text-lg font-semibold text-white mb-4">{title}</h2>
      <div className="space-y-3">
        {visits.map((visit) => {
          const statusStyle = STATUS_STYLES[visit.status] || STATUS_STYLES.REQUESTED;
          const IconComponent = statusStyle.icon;
          return (
            <div
              key={visit.id}
              className="group flex gap-4 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-[#d8a94e]/30 hover:bg-white/10"
            >
              <div className="relative h-20 w-28 flex-shrink-0 rounded-lg overflow-hidden">
                {visit.property && parseCoverImage(visit.property.imagesJson) ? (
                  <Image
                    src={parseCoverImage(visit.property.imagesJson)!}
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
                <span className="absolute bottom-1.5 left-1.5 right-1.5 rounded-full border border-success/30 bg-success-soft px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-success">
                  {visit.property?.propertyType?.replace("_", " ") ?? "Property"}
                </span>
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <Link href={`/explore/${visit.propertyId}`} className="font-medium text-white truncate group-hover:text-[#ffdf9e] transition-colors">
                      {visit.property?.projectName ?? "Property Unavailable"}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${statusStyle.bg} ${statusStyle.text}`}>
                      {visit.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60">
                    <MapPin size={12} className="text-[#ffdf9e]" />
                    <span className="truncate">{visit.property?.locality ?? ""}{visit.property?.locality && visit.property?.city ? ", " : ""}{visit.property?.city ?? ""}</span>
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {visit.property?.bhk && <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70">{visit.property.bhk} BHK</span>}
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70 flex items-center gap-1">
                    <CalendarClock size={10} />
                    {formatDisplayDateTime(visit.scheduledAt)}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[#ffdf9e]">
                    <LinkIcon size={12} />
                    <Link href={`/explore/${visit.propertyId}`} className="hover:underline">View Property</Link>
                  </span>
                  {showActions && ["REQUESTED", "SCHEDULED", "CONFIRMED"].includes(visit.status) && (
                    <button
                      onClick={() => handleCancel(visit.id)}
                      disabled={cancelLoading === visit.id}
                      className="flex items-center gap-1 text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      {cancelLoading === visit.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                      <span>Cancel</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}