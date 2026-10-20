import { getCurrentSession } from "@/lib/auth";
import { canManageAllLeads } from "@/lib/lead-access";
import { getTenantAnalyticsSnapshot } from "@/lib/data/analytics";
import { leadsOverTime } from "@/lib/data/leads";
import { FunnelChart, TrendChart, SourcePie, TemperatureBar } from "@/components/charts";
import { ArrowUpRight, CalendarClock, TrendingUp, Users, Flame, Target } from "lucide-react";
import { PilotSummary } from "./pilot-summary";

export default async function AnalyticsPage() {
  const session = await getCurrentSession();
  const organizationId = (session?.user as any)?.organizationId as string | undefined;
  const role = (session?.user as any)?.role as string;
  const userId = (session?.user as any)?.id as string;

  if (!organizationId) {
    throw new Error("No organization on this account");
  }

  const [analytics, overTime] = await Promise.all([
    getTenantAnalyticsSnapshot(organizationId),
    leadsOverTime(organizationId, 30),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <span className="eyebrow">Performance</span>
        <h1 className="mt-3 font-display text-3xl text-ink">Analytics</h1>
      </div>

      <div className="grid gap-5 md:grid-cols-4">
        <div className="panel-surface p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">Total leads</p>
          <p className="mt-3 text-3xl font-semibold text-brand">{analytics.totalLeads}</p>
        </div>        <div className="panel-surface p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">Qualified leads</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{analytics.qualifiedLeads}</p>
        </div>
        <div className="panel-surface p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">Conversion rate</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{analytics.conversionRate}%</p>
        </div>
        <div className="panel-surface p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">Site visits</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{analytics.siteVisits}</p>
        </div>
      </div>

      <PilotSummary
        organizationId={organizationId}
        assignedAgentId={canManageAllLeads(role) ? undefined : userId}
      />

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="panel-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Conversion funnel</h2>
            <ArrowUpRight className="h-4 w-4 text-brand" />
          </div>
          <FunnelChart data={analytics.pipeline} />
        </div>

        <div className="panel-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Leads over time</h2>
            <TrendingUp className="h-4 w-4 text-brand" />
          </div>
          <TrendChart data={overTime as any} />
        </div>

        <div className="panel-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Lead source</h2>
            <Users className="h-4 w-4 text-brand" />
          </div>
          <SourcePie data={analytics.leadSources as any} />
        </div>

        <div className="panel-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Lead temperature mix</h2>
            <Flame className="h-4 w-4 text-brand" />
          </div>
          <TemperatureBar hot={analytics.hotLeads} warm={analytics.warmLeads} cold={analytics.coldLeads} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="panel-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Recent leads</h2>
            <Target className="h-4 w-4 text-brand" />
          </div>
          <div className="space-y-3">
            {analytics.recentLeads.map((lead) => (
              <div key={lead.id} className="inset-row flex items-center justify-between p-3">
                <div>
                  <p className="font-medium text-ink">{lead.name}</p>
                  <p className="text-xs text-slate">{lead.source} · {lead.temperature}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-ink">{lead.status}</p>
                  <p className="text-xs text-slate">{lead.budgetMaxInr ? `₹${lead.budgetMaxInr.toLocaleString("en-IN")}` : "No budget"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Recent activity</h2>
            <CalendarClock className="h-4 w-4 text-brand" />
          </div>
          <div className="space-y-3">
            {analytics.recentActivity.map((activity, index) => (
              <div key={`${activity.label}-${activity.timestamp}-${index}`} className="inset-row flex items-center justify-between p-3">
                <div>
                  <p className="font-medium text-ink">{activity.label}</p>
                  <p className="text-xs text-slate">{new Date(activity.timestamp).toLocaleDateString()}</p>
                </div>
                <span className="rounded-full bg-brand-soft px-2 py-1 text-xs font-medium text-brand">{activity.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
