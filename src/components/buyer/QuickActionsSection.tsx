"use client";

import Link from "next/link";
import { Search, Heart, Scale, TrendingUp, CalendarClock, Plus, UserCircle, Settings } from "lucide-react";

const QUICK_ACTIONS = [
  { href: "/buyer/explore", label: "Explore Properties", description: "Browse all available listings", icon: Search, color: "text-[#d8a94e]", bg: "bg-[#d8a94e]/10" },
  { href: "/buyer/saved", label: "Saved Properties", description: "View your favourite listings", icon: Heart, color: "text-[#ef4444]", bg: "bg-[#ef4444]/10" },
  { href: "/buyer/compare", label: "Compare Properties", description: "Side-by-side comparison", icon: Scale, color: "text-[#3b82f6]", bg: "bg-[#3b82f6]/10" },
  { href: "/buyer/insights", label: "Investment Insights", description: "Price trends & projections", icon: TrendingUp, color: "text-[#22c55e]", bg: "bg-[#22c55e]/10" },
  { href: "/buyer/visits", label: "Schedule a Visit", description: "Book a site visit", icon: CalendarClock, color: "text-[#a855f7]", bg: "bg-[#a855f7]/10" },
  { href: "/buyer/profile", label: "Profile & Settings", description: "Manage your account", icon: UserCircle, color: "text-[#64748b]", bg: "bg-[#64748b]/10" },
];

export function QuickActionsSection() {
  return (
    <div className="panel-surface p-5">
      <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group flex gap-4 p-4 rounded-xl border border-white/10 bg-white/5 transition hover:border-white/20 hover:bg-white/10"
          >
            <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${action.bg}`}>
              <action.icon size={20} className={action.color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-white group-hover:text-[#ffdf9e] transition-colors">{action.label}</p>
              <p className="mt-1 text-sm text-white/50">{action.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}