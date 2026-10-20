"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard, Users, Building2, MessageSquare, CalendarClock,
  BarChart3, Settings, ShieldCheck, LogOut, UserCircle2, TrendingUp, Mic,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/voice", label: "Voice AI", icon: Mic },
  { href: "/properties", label: "Properties", icon: Building2 },
  { href: "/appointments", label: "Appointments", icon: CalendarClock },
  { href: "/recovery", label: "Recovery", icon: TrendingUp },
  { href: "/team", label: "Sales team", icon: UserCircle2 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * App navigation. Collapses to a 72px icon rail below `xl` so the workspace
 * stays usable on tablet and mobile without introducing a separate menu.
 * Visual only — same routes, same active-state logic.
 */
export default function Sidebar({ role, orgName }: { role: string; orgName: string }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col border-r border-white/10 bg-[radial-gradient(circle_at_top,_rgba(120,157,181,0.16),_transparent_32%),linear-gradient(180deg,#0e1d2a_0%,#0b1620_100%)] text-slate-200 shadow-[0_20px_40px_rgba(10,17,26,0.18)] xl:w-72">
      <div className="border-b border-white/10 px-4 py-5 xl:px-5">
        <Link href="/dashboard" className="flex items-center gap-3" title="Basera">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-[#d8a94e] to-[#8a6238] text-base font-semibold text-[#1a1206] shadow-[0_10px_22px_rgba(216,169,78,0.28)]">
            B
          </span>
          <span className="hidden font-display text-2xl tracking-wide text-white xl:inline">Basera</span>
        </Link>
        <p className="mt-3 hidden truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300/70 xl:block">
          {orgName}
        </p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
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

        {role === "SUPER_ADMIN" && (
          <Link
            href="/admin"
            title="Platform admin"
            className={`mt-2 flex items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200 xl:justify-start ${
              pathname?.startsWith("/admin")
                ? "bg-white/[0.94] text-[#0e1d2a] shadow-[0_10px_22px_rgba(0,0,0,0.28)]"
                : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            <ShieldCheck size={17} className={pathname?.startsWith("/admin") ? "text-[#0f5132]" : "text-slate-400"} />
            <span className="hidden xl:inline">Platform admin</span>
          </Link>
        )}
      </nav>

      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          title="Sign out"
          onClick={() => {
            // Sign out WITHOUT trusting the server-side callbackUrl: next-auth
            // resolves it against NEXTAUTH_URL, and a NEXTAUTH_URL that has
            // drifted from the running host:port (e.g. a dev server that fell
            // back to 3001) used to bounce users to a dead origin — the
            // "intermittent 404" after logout. `redirect:false` still clears
            // the session server-side; we then navigate on THIS origin, which
            // can never be an open redirect.
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
