"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard, Users, Building2, MessageSquare, CalendarClock,
  BarChart3, Settings, ShieldCheck, LogOut, UserCircle2,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/properties", label: "Properties", icon: Building2 },
  { href: "/appointments", label: "Appointments", icon: CalendarClock },
  { href: "/team", label: "Sales team", icon: UserCircle2 },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar({ role, orgName }: { role: string; orgName: string }) {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 border-r border-line bg-panel h-screen sticky top-0 flex flex-col">
      <div className="px-5 py-5 border-b border-line">
        <Link href="/dashboard" className="font-display text-xl text-brand">Basera</Link>
        <p className="text-xs text-slate2 mt-0.5 truncate">{orgName}</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active ? "bg-brand-light text-brand" : "text-slate2 hover:bg-paper hover:text-ink"
              }`}>
              <Icon size={17} /> {item.label}
            </Link>
          );
        })}
        {role === "SUPER_ADMIN" && (
          <Link href="/admin" className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium ${pathname?.startsWith("/admin") ? "bg-gold-light text-gold" : "text-slate2 hover:bg-paper hover:text-ink"}`}>
            <ShieldCheck size={17} /> Platform admin
          </Link>
        )}
      </nav>
      <button onClick={() => signOut({ callbackUrl: "/login" })}
        className="m-3 flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-slate2 hover:bg-paper hover:text-hot">
        <LogOut size={17} /> Sign out
      </button>
    </aside>
  );
}
