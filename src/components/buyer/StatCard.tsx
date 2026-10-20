"use client";

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: string;
}

export function StatCard({ label, value, icon, accent }: StatCardProps) {
  return (
    <div className="panel-surface card-hover group p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">{label}</p>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-transform duration-200 group-hover:scale-105">
          {icon}
        </span>
      </div>
      <p className={`mt-4 text-2xl font-semibold tracking-[-0.04em] ${accent}`}>{value}</p>
    </div>
  );
}