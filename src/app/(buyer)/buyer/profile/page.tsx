import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { getSavedProperties, getVisitRequests, getComparisons, getBuyerPreferences } from "@/lib/data/buyer";
import { Reveal } from "@/components/reveal";
import { ProfileForm } from "@/components/buyer/ProfileForm";
import { AccountSecuritySection } from "@/components/buyer/AccountSecuritySection";
import { NotificationPreferencesSection } from "@/components/buyer/NotificationPreferencesSection";
import { DangerZoneSection } from "@/components/buyer/DangerZoneSection";
import { BuyerPreferencesSection } from "@/components/buyer/BuyerPreferencesSection";

export const metadata: Metadata = {
  title: "Profile & Account",
  description: "Manage your Basera buyer account settings.",
  alternates: { canonical: "/buyer/profile" },
  robots: { index: false, follow: false },
};

export default async function BuyerProfilePage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/buyer/login");
  if ((session.user as any).role !== "BUYER") redirect("/dashboard");

  const userId = (session.user as any).id as string;
  const user = session.user as any;

  const [savedProperties, visitRequests, comparisons, preferences] = await Promise.all([
    getSavedProperties(userId),
    getVisitRequests(userId),
    getComparisons(userId),
    getBuyerPreferences(userId),
  ]);

  const initials = user.name
    ?.split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) ?? "BU";

  return (
    <div className="space-y-8 theme-dark">
      <Reveal className="text-center">
        <span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Account Settings</span>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.02] text-white">Profile & Account</h1>
        <p className="mt-3 max-w-2xl mx-auto text-base leading-7 text-white/65">
          Manage your personal information, preferences, and account settings.
        </p>
      </Reveal>

      {/* grid-cols-1 keeps the below-lg track minmax(0,1fr): without it the
          implicit track sized to the content min-width (~386px during the
          webfont-fallback phase) and the page overflowed at phone widths. */}
      <Reveal delayMs={80} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-4">
          <div className="panel-surface p-6 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#d8a94e] to-[#8a6238] text-3xl font-bold text-[#1a1206]">
                {initials}
              </div>
              <div>
                <h2 className="font-display text-2xl text-white">{user.name ?? "Buyer"}</h2>
                <p className="mt-1 text-sm text-white/50">{user.email}</p>
                <span className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-[11px] font-medium uppercase tracking-[0.1em]">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" /> Active
                </span>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-xl border border-white/10 bg-white/5">
                <p className="text-2xl font-semibold text-[#d8a94e]">{savedProperties.length}</p>
                <p className="text-xs text-white/50">Saved Properties</p>
              </div>
              <div className="p-3 rounded-xl border border-white/10 bg-white/5">
                <p className="text-2xl font-semibold text-[#3b82f6]">{comparisons.length}</p>
                <p className="text-xs text-white/50">Comparisons</p>
              </div>
              <div className="p-3 rounded-xl border border-white/10 bg-white/5">
                <p className="text-2xl font-semibold text-[#22c55e]">{visitRequests.length}</p>
                <p className="text-xs text-white/50">Visit Requests</p>
              </div>
            </div>
          </div>

          <ProfileForm userName={user.name ?? ""} userEmail={user.email ?? ""} userPhone={user.phone ?? ""} />
          <BuyerPreferencesSection initialPreferences={preferences} userId={userId} />
        </div>

        <div className="space-y-4">
          <AccountSecuritySection />
          <NotificationPreferencesSection />
          <DangerZoneSection />
        </div>
      </Reveal>
    </div>
  );
}