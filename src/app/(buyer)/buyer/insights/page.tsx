import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { getSavedProperties, getVisitRequests, getComparisons } from "@/lib/data/buyer";
import { listPublicProperties } from "@/lib/data/properties";
import { formatInr } from "@/lib/formatters";
import { Reveal } from "@/components/reveal";
import { InvestmentCalculator } from "@/components/buyer/InvestmentCalculator";
import { StatCard } from "@/components/buyer/StatCard";
import { DisclaimerSection } from "@/components/buyer/DisclaimerSection";
import { DollarSign, Home, CalendarClock, Scale, TrendingUp } from "lucide-react";

export const metadata: Metadata = {
  title: "Investment Insights",
  description: "Analyze property investments with calculators and market data.",
  alternates: { canonical: "/buyer/insights" },
  robots: { index: false, follow: false },
};

export default async function BuyerInsightsPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/buyer/login");
  if ((session.user as any).role !== "BUYER") redirect("/dashboard");

  const userId = (session.user as any).id as string;

  const [savedProperties, visitRequests, comparisons, allProperties] = await Promise.all([
    getSavedProperties(userId),
    getVisitRequests(userId),
    getComparisons(userId),
    listPublicProperties({}),
  ]);

  const totalSavedValue = savedProperties.reduce((sum, { property }) => sum + property.priceMinInr, 0);
  const avgPricePerSqft = allProperties.length > 0
    ? Math.round(allProperties.reduce((sum, { property }) => sum + (property.areaSqft ? property.priceMinInr / property.areaSqft : 0), 0) / allProperties.length)
    : 0;

  const cities = Array.from(new Set(allProperties.map(({ property }) => property.city).filter(Boolean)));

  return (
    <div className="space-y-8 theme-dark">
      <Reveal className="text-center">
        <span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Investment Insights</span>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.02] text-white">Investment Insights</h1>
        <p className="mt-3 max-w-2xl mx-auto text-base leading-7 text-white/65">
          Calculate returns, analyze price trends, and make informed property investment decisions.
        </p>
      </Reveal>

      <Reveal delayMs={80} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Saved Properties Value" value={formatInr(totalSavedValue)} icon={<DollarSign size={24} className="text-[#d8a94e]" />} accent="text-[#d8a94e]" />
        <StatCard label="Avg Price / sq ft" value={formatInr(avgPricePerSqft) + " / sq ft"} icon={<Home size={24} className="text-[#3b82f6]" />} accent="text-[#3b82f6]" />
        <StatCard label="Upcoming Visits" value={visitRequests.filter(v => v.status === "SCHEDULED" || v.status === "CONFIRMED" || v.status === "REQUESTED").length.toString()} icon={<CalendarClock size={24} className="text-[#22c55e]" />} accent="text-[#22c55e]" />
        <StatCard label="Active Comparisons" value={comparisons.length.toString()} icon={<Scale size={24} className="text-[#a855f7]" />} accent="text-[#a855f7]" />
      </Reveal>

      <Reveal delayMs={160}>
        <InvestmentCalculator />
      </Reveal>

      <Reveal delayMs={240}>
        <div className="panel-surface p-5">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp size={20} className="text-[#d8a94e]" /> Market Overview
          </h2>
          <p className="text-sm text-white/50 mb-4">Key metrics from available listings across {cities.length} cities.</p>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Total Listings" value={allProperties.length.toString()} />
            <MetricCard label="Cities Covered" value={cities.length.toString()} />
            <MetricCard label="Avg Property Price" value={formatInr(Math.round(allProperties.reduce((s, { property }) => s + property.priceMinInr, 0) / allProperties.length))} />
            <MetricCard label="Price Range" value={`${formatInr(Math.min(...allProperties.map(({ property }) => property.priceMinInr)))} – ${formatInr(Math.max(...allProperties.map(({ property }) => property.priceMinInr)))}`} />
            <MetricCard label="Most Common Type" value={getMostCommonType(allProperties)} />
            <MetricCard label="Avg Area" value={`${Math.round(allProperties.reduce((s, { property }) => s + (property.areaSqft || 0), 0) / allProperties.length).toLocaleString()} sq ft`} />
          </div>
        </div>
      </Reveal>

      <Reveal delayMs={320}>
        <DisclaimerSection />
      </Reveal>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs font-medium text-white/60">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function getMostCommonType(properties: Array<{ property: { propertyType: string } }>): string {
  const counts: Record<string, number> = {};
  for (const { property } of properties) {
    counts[property.propertyType] = (counts[property.propertyType] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]?.replace("_", " ") ?? "—";
}