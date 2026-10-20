"use client";

import Link from "next/link";
import { MapPin, Building2, CalendarClock, Clock, CheckCircle, AlertCircle, X, ArrowRight } from "lucide-react";
import { formatInr, formatDisplayDateTime } from "@/lib/formatters";

interface Visit {
  id: string;
  propertyId: string;
  propertyName: string | null;
  propertyType: string | null;
  bhk: number | null;
  city: string | null;
  locality: string | null;
  priceMinInr: number | null;
  scheduledAt: string;
  status: "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELED" | "NO_SHOW" | "REQUESTED";
  agentName?: string;
}

interface UpcomingVisitsSectionProps {
  visits: Visit[];
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  SCHEDULED: { bg: "bg-blue-500/20", text: "text-blue-400", icon: Clock },
  CONFIRMED: { bg: "bg-green-500/20", text: "text-green-400", icon: CheckCircle },
  COMPLETED: { bg: "bg-gray-500/20", text: "text-gray-400", icon: CheckCircle },
  CANCELED: { bg: "bg-red-500/20", text: "text-red-400", icon: X },
  NO_SHOW: { bg: "bg-orange-500/20", text: "text-orange-400", icon: AlertCircle },
};

export function UpcomingVisitsSection({ visits }: UpcomingVisitsSectionProps) {
  if (visits.length === 0) {
    return (
      <div className="panel-surface p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Upcoming Visits</h2>
        <div className="text-center py-8 text-white/50">
          <CalendarClock size={32} className="mx-auto text-white/20" />
          <p className="mt-3 text-lg">No upcoming visits</p>
          <p className="mt-1 text-sm">Schedule a site visit for a property you like</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-surface p-5">
      <h2 className="text-lg font-semibold text-white mb-4">Upcoming Visits</h2>
      <div className="space-y-3">
        {visits.map((visit) => {
          const statusStyle = STATUS_STYLES[visit.status] || STATUS_STYLES.SCHEDULED;
          const IconComponent = statusStyle.icon;
          return (
            <Link
              key={visit.id}
              href={`/explore/${visit.propertyId}`}
              className="group flex gap-4 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-[#d8a94e]/30 hover:bg-white/10"
            >
              <div className="relative h-20 w-28 flex-shrink-0 rounded-lg overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center" style={{
                  backgroundImage:
                    "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px), linear-gradient(160deg, #16202f 0%, #101825 55%, #0f1f1a 100%)",
                }}>
                  <Building2 size={24} className="text-white/20" />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <span className="absolute bottom-1.5 left-1.5 right-1.5 rounded-full border border-success/30 bg-success-soft px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-success">
                  {visit.propertyType?.replace("_", " ") ?? "Property"}
                </span>
              </div>
              
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-white truncate">{visit.propertyName}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${statusStyle.bg} ${statusStyle.text}`}>
                      {visit.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-white/60">
                    <MapPin size={12} className="text-[#ffdf9e]" />
                    <span className="truncate">{visit.locality ?? ""}{visit.locality && visit.city ? ", " : ""}{visit.city ?? ""}</span>
                  </p>
                </div>
                
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {visit.bhk && <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70">{visit.bhk} BHK</span>}
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-white/70 flex items-center gap-1">
                    <CalendarClock size={10} />
                    {formatDisplayDateTime(visit.scheduledAt)}
                  </span>
                </div>
                
                <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                  {visit.agentName && (
                    <span className="text-sm text-white/50 flex items-center gap-1">
                      <Building2 size={12} />
                      {visit.agentName}
                    </span>
                  )}
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