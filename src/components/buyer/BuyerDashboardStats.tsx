"use client";

import Link from "next/link";
import { Heart, Scale, TrendingUp, CalendarClock, Plus, Search, ArrowRight } from "lucide-react";

interface BuyerDashboardStatsProps {
  userId: string;
  savedCount: number;
  comparisonCount: number;
  visitCount: number;
  savedSearchesCount?: number;
}

export function BuyerDashboardStats({ 
  userId, 
  savedCount, 
  comparisonCount, 
  visitCount,
  savedSearchesCount = 0,
}: BuyerDashboardStatsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Saved Properties"
        value={savedCount}
        icon={<Heart size={18} className="text-[#d8a94e]" />}
        accent="text-[#d8a94e]"
        action={
          <Link href="/buyer/saved" className="text-sm font-medium text-[#d8a94e] hover:underline flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        }
      />
      <StatCard
        label="Comparisons"
        value={comparisonCount}
        icon={<Scale size={18} className="text-[#3b82f6]" />}
        accent="text-[#3b82f6]"
        action={
          <Link href="/buyer/compare" className="text-sm font-medium text-[#3b82f6] hover:underline flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        }
      />
      <StatCard
        label="Upcoming Visits"
        value={visitCount}
        icon={<CalendarClock size={18} className="text-[#22c55e]" />}
        accent="text-[#22c55e]"
        action={
          <Link href="/buyer/visits" className="text-sm font-medium text-[#22c55e] hover:underline flex items-center gap-1">
            View all <ArrowRight size={12} />
          </Link>
        }
      />
      <StatCard
        label="Saved Searches"
        value={savedSearchesCount}
        icon={<Search size={18} className="text-[#a855f7]" />}
        accent="text-[#a855f7]"
        action={
          <button className="text-sm font-medium text-[#a855f7] hover:underline flex items-center gap-1">
            Create <Plus size={12} />
          </button>
        }
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
  action,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
  action: React.ReactNode;
}) {
  return (
    <div className="panel-surface card-hover group p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">{label}</p>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-transform duration-200 group-hover:scale-105">
          {icon}
        </span>
      </div>
      <p className={`mt-4 text-2xl font-semibold tracking-[-0.04em] ${accent}`}>{value}</p>
      <div className="mt-4">{action}</div>
    </div>
  );
}