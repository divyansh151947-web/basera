import { getCurrentSession } from "@/lib/auth";
import { getDashboardCounts, leadsOverTime, leadsBySource } from "@/lib/data/leads";
import { StatCard } from "@/components/ui";
import { FunnelChart, TrendChart, SourcePie, TemperatureBar } from "@/components/charts";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  const organizationId = (session!.user as any).organizationId as string;

  const [counts, overTime, bySource] = await Promise.all([
    getDashboardCounts(organizationId),
    leadsOverTime(organizationId, 30),
    leadsBySource(organizationId),
  ]);

  const funnelOrder = ["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED"];
  const funnel = funnelOrder.map((stage) => ({ stage, count: counts.byStatus[stage] ?? 0 }));

  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-2xl text-ink">Dashboard</h1>
      <p className="text-sm text-slate2 mt-1">A snapshot of your lead pipeline and AI activity.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        <StatCard label="Total leads" value={counts.total} />
        <StatCard label="Hot leads" value={counts.byTemp["HOT"] ?? 0} accent="text-hot" />
        <StatCard label="Warm leads" value={counts.byTemp["WARM"] ?? 0} accent="text-warm" />
        <StatCard label="Cold leads" value={counts.byTemp["COLD"] ?? 0} accent="text-cold" />
        <StatCard label="Qualified" value={counts.byStatus["QUALIFIED"] ?? 0} />
        <StatCard label="Site visits" value={counts.byStatus["SITE_VISIT_SCHEDULED"] ?? 0} />
        <StatCard label="Conversion rate" value={`${counts.conversionRate}%`} />
        <StatCard label="Follow-ups due" value={counts.followUpsDue} accent={counts.followUpsDue > 0 ? "text-hot" : "text-ink"} />
      </div>

      {counts.needsHumanAttention > 0 && (
        <div className="mt-4 rounded-lg border border-hot/30 bg-hot/5 px-4 py-3 text-sm text-hot">
          {counts.needsHumanAttention} hot lead{counts.needsHumanAttention > 1 ? "s need" : " needs"} an assigned salesperson.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6 mt-8">
        <div className="rounded-lg border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold text-ink mb-1">Conversion funnel</h2>
          <p className="text-xs text-slate2 mb-2">Leads → Contacted → Qualified → Site Visit → Negotiation → Converted</p>
          <FunnelChart data={funnel} />
        </div>
        <div className="rounded-lg border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold text-ink mb-1">Leads over time</h2>
          <p className="text-xs text-slate2 mb-2">Last 30 days</p>
          <TrendChart data={overTime as any} />
        </div>
        <div className="rounded-lg border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold text-ink mb-3">Lead source</h2>
          <SourcePie data={bySource as any} />
        </div>
        <div className="rounded-lg border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold text-ink mb-3">Lead temperature mix</h2>
          <TemperatureBar hot={counts.byTemp["HOT"] ?? 0} warm={counts.byTemp["WARM"] ?? 0} cold={counts.byTemp["COLD"] ?? 0} />
        </div>
      </div>
    </div>
  );
}
