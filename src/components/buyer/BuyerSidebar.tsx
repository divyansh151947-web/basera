"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard, Heart, Scale, TrendingUp, CalendarClock, UserCircle, LogOut, Search,
} from "lucide-react";

const BUYER_NAV = [
  { href: "/buyer", label: "Overview", icon: LayoutDashboard },
  { href: "/buyer/explore", label: "Explore Properties", icon: Search },
  { href: "/buyer/saved", label: "Saved Properties", icon: Heart },
  { href: "/buyer/compare", label: "Compare Properties", icon: Scale },
  { href: "/buyer/insights", label: "Investment Insights", icon: TrendingUp },
  { href: "/buyer/visits", label: "Visit Requests", icon: CalendarClock },
  { href: "/buyer/profile", label: "Profile & Account", icon: UserCircle },
];

export default function BuyerSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col border-r border-white/10 bg-[radial-gradient(circle_at_top,_rgba(120,157,181,0.16),_transparent_32%),linear-gradient(180deg,#0e1d2a_0%,#0b1620_100%)] text-slate-200 shadow-[0_20px_40px_rgba(10,17,26,0.18)] xl:w-72">
      <div className="border-b border-white/10 px-4 py-5 xl:px-5">
        <Link href="/buyer" className="flex items-center gap-3" title="Basera">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-[#d8a94e] to-[#8a6238] text-base font-semibold text-[#1a1206] shadow-[0_10px_22px_rgba(216,169,78,0.28)]">
            B
          </span>
          <span className="hidden font-display text-2xl tracking-wide text-white xl:inline">Basera</span>
        </Link>
        <p className="mt-3 hidden truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/70 xl:block">
          My Basera
        </p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {BUYER_NAV.map((item) => {
          const active = pathname === item.href || (item.href !== "/buyer" && pathname?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200 xl:justify-start ${
                active
                  ? "bg-white/[0.94] text-[#0e1d2a] shadow-[0_10px_22px_rgba(0,0,0,0.28)]"
                  : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              <Icon size={17} className={active ? "text-[#0f5132]" : "text-slate-400"} />
              <span className="hidden xl:inline">{item.label}</span>
              {active && <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-[#0f5132] xl:block" aria-hidden />}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          title="Sign out"
          onClick={() => {
            // Same-origin logout: `redirect:false` clears the session without
            // letting next-auth resolve the landing URL against NEXTAUTH_URL
            // (a drifted NEXTAUTH_URL used to send buyers to a dead origin).
            const origin = typeof window !== "undefined" ? window.location.origin : "";
            signOut({ callbackUrl: `${origin}/`, redirect: false }).finally(() => {
              window.location.assign(`${origin}/`);
            });
          }}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.06] hover:text-white xl:justify-start"
        >
          <LogOut size={17} />
          <span className="hidden xl:inline">Sign out</span>
        </button>
      </div>
    </aside>
  );
}