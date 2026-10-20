"use client";

import type { ReactNode } from "react";

export { formatInr, formatBudgetRange } from "@/lib/formatters";

export function StatCard({ label, value, accent, icon }: { label: string; value: string | number; accent?: string; icon?: ReactNode }) {
  return (
    <div className="panel-surface card-hover group p-4 md:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">{label}</p>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-brand/15 bg-brand-soft text-brand transition-transform duration-200 group-hover:scale-105">
          {icon ?? <span className="h-2.5 w-2.5 rounded-full bg-current" />}
        </span>
      </div>
      <p className={`mt-4 text-2xl font-semibold tracking-[-0.04em] ${accent ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

const TEMP_STYLES: Record<string, string> = {
  HOT: "border-danger/20 bg-danger-soft text-danger",
  WARM: "border-warning/25 bg-warning-soft text-warning",
  COLD: "border-brand/20 bg-brand-soft text-brand",
};

export function TempBadge({ temperature }: { temperature: string }) {
  return (
    <span className={`badge ${TEMP_STYLES[temperature] ?? ""}`}>
      {temperature}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  INTERESTED: "Interested",
  SITE_VISIT_SCHEDULED: "Site visit scheduled",
  NEGOTIATION: "Negotiation",
  CONVERTED: "Converted",
  LOST: "Lost",
  NURTURE: "Nurture",
};

export function StatusBadge({ status }: { status: string }) {
  const normalized = STATUS_LABEL[status] ?? status;
  return <span className="badge">{normalized}</span>;
}
