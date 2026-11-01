"use client";

import dynamic from "next/dynamic";

type FunnelDatum = { stage: string; count: number };
type TrendDatum = { date: string; count: number };
type SourceDatum = { source: string; count: number };

const FunnelChart = dynamic(() => import("@/components/charts").then((mod) => mod.FunnelChart), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-white/5" aria-busy="true" /> });
const TrendChart = dynamic(() => import("@/components/charts").then((mod) => mod.TrendChart), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-white/5" aria-busy="true" /> });
const SourcePie = dynamic(() => import("@/components/charts").then((mod) => mod.SourcePie), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-white/5" aria-busy="true" /> });
const TemperatureBar = dynamic(() => import("@/components/charts").then((mod) => mod.TemperatureBar), { ssr: false, loading: () => <div className="h-16 animate-pulse rounded-xl bg-white/5" aria-busy="true" /> });
const RevenueTower = dynamic(() => import("@/components/property-tour/RevenueTower").then((mod) => mod.RevenueTower), { ssr: false, loading: () => <div className="h-40 animate-pulse rounded-2xl bg-white/5" aria-busy="true" /> });

export function DashboardFunnelChart({ data }: { data: FunnelDatum[] }) {
  return <FunnelChart data={data} />;
}

export function DashboardTrendChart({ data }: { data: TrendDatum[] }) {
  return <TrendChart data={data} />;
}

export function DashboardSourcePie({ data }: { data: SourceDatum[] }) {
  return <SourcePie data={data} />;
}

export function DashboardTemperatureBar(props: { hot: number; warm: number; cold: number }) {
  return <TemperatureBar {...props} />;
}

export function DashboardRevenueTower(props: { atRisk: number; critical: number }) {
  return <RevenueTower {...props} />;
}