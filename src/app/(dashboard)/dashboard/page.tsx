import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { getDashboardCounts, leadsOverTime, leadsBySource } from "@/lib/data/leads";
import { getRevenueIntelligence } from "@/lib/revenue-intelligence";
import { canManageAllLeads } from "@/lib/lead-access";
import { formatInr } from "@/lib/formatters";
import { StatCard } from "@/components/ui";
import dynamic from "next/dynamic";
import { OnboardingChecklist } from "@/components/onboarding-checklist";
import { ArrowUpRight, CircleDashed, Flame, Users, Target, CalendarClock, TrendingUp } from "lucide-react";
import Link from "next/link";

// Lazy-load charts (heavy recharts dependency) and the 3D revenue tower
// (heavy three dependency) so the dashboard shell paints first.
const FunnelChart = dynamic(() => import("@/components/charts").then((mod) => mod.FunnelChart), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-white/5" aria-busy="true" /> });
const TrendChart = dynamic(() => import("@/components/charts").then((mod) => mod.TrendChart), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-white/5" aria-busy="true" /> });
const SourcePie = dynamic(() => import("@/components/charts").then((mod) => mod.SourcePie), { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-white/5" aria-busy="true" /> });
const TemperatureBar = dynamic(() => import("@/components/charts").then((mod) => mod.TemperatureBar), { ssr: false, loading: () => <div className="h-16 animate-pulse rounded-xl bg-white/5" aria-busy="true" /> });
const RevenueTower = dynamic(() => import("@/components/property-tour/RevenueTower").then((mod) => mod.RevenueTower), { ssr: false, loading: () => <div className="h-40 animate-pulse rounded-2xl bg-white/5" aria-busy="true" /> });

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;
  const role = (session.user as any).role as string;
  const userId = (session.user as any).id as string;

  const [counts, overTime, bySource, intel] = await Promise.all([
    getDashboardCounts(organizationId),
    leadsOverTime(organizationId, 30),
    leadsBySource(organizationId),
    getRevenueIntelligence(organizationId, canManageAllLeads(role) ? {} : { assignedAgentId: userId }),
  ]);
  // The intelligence payload carries the three engine outputs, so every
  // existing section below keeps working from these aliases.
  const revenueRisk = intel.risk;
  const recovery = intel.recovery;
  const nextBest = intel.nextBest;
  const recoveryActionByLead = new Map(recovery.candidates.map((c) => [c.leadId, c.decision]));
  const recoveryActionLabel: Record<string, string> = {
    FOLLOW_UP: "Follow up",
    AGENT_ALERT: "Alert agent",
    MANAGER_ESCALATION: "Escalate",
    REACTIVATION: "Reactivate",
    SITE_VISIT_RECOVERY: "Reschedule visit",
    HUMAN_HANDOFF: "Handoff",
  };

  const funnelOrder = ["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED"];
  const funnel = funnelOrder.map((stage) => ({ stage, count: counts.byStatus[stage] ?? 0 }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="eyebrow">Overview</span>
          <h1 className="mt-3 font-display text-3xl text-ink">Dashboard</h1>
        </div>
        <div className="notice max-w-md rounded-2xl">
          A snapshot of your lead pipeline and AI activity.
        </div>
      </div>

      <OnboardingChecklist organizationId={organizationId} />

      <RevenueTower atRisk={revenueRisk.totalRevenueAtRisk} critical={revenueRisk.counts.CRITICAL} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total leads" value={counts.total} icon={<Users size={15} />} />
        <StatCard label="Hot leads" value={counts.byTemp["HOT"] ?? 0} accent="text-danger" icon={<Flame size={15} />} />
        <StatCard label="Warm leads" value={counts.byTemp["WARM"] ?? 0} accent="text-warning" icon={<CircleDashed size={15} />} />
        <StatCard label="Cold leads" value={counts.byTemp["COLD"] ?? 0} accent="text-brand" icon={<Target size={15} />} />
        <StatCard label="Qualified" value={counts.byStatus["QUALIFIED"] ?? 0} icon={<ArrowUpRight size={15} />} />
        <StatCard label="Site visits" value={counts.byStatus["SITE_VISIT_SCHEDULED"] ?? 0} icon={<CalendarClock size={15} />} />
        <StatCard label="Conversion rate" value={`${counts.conversionRate}%`} icon={<TrendingUp size={15} />} />
        <StatCard label="Follow-ups due" value={counts.followUpsDue} accent={counts.followUpsDue > 0 ? "text-danger" : "text-ink"} icon={<CalendarClock size={15} />} />
      </div>

      {counts.needsHumanAttention > 0 && (
        <div className="rounded-2xl border border-danger/20 bg-danger-soft px-4 py-3 text-sm font-medium text-danger shadow-[0_8px_20px_rgba(177,74,68,0.06)]">
          {counts.needsHumanAttention} hot lead{counts.needsHumanAttention > 1 ? "s need" : " needs"} an assigned salesperson.
        </div>
      )}

      <div className="panel-surface p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-ink">Revenue at risk</h2>
            <p className="text-sm text-slate">Potential transaction value on leads showing loss-risk signals — not guaranteed revenue.</p>
          </div>
          <span className="text-2xl font-semibold tracking-[-0.05em] text-brand">{formatInr(revenueRisk.totalRevenueAtRisk)}</span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-danger-soft px-2.5 py-1 text-danger">Critical · {revenueRisk.counts.CRITICAL}</span>
          <span className="rounded-full bg-warning-soft px-2.5 py-1 text-warning">High · {revenueRisk.counts.HIGH}</span>
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-brand">Medium · {revenueRisk.counts.MEDIUM}</span>
          <span className="rounded-full bg-paper px-2.5 py-1 text-slate">Low · {revenueRisk.counts.LOW}</span>
          {recovery.candidates.length > 0 && (
            <span className="rounded-full bg-gold-light px-2.5 py-1 text-gold">Recovery needed · {recovery.candidates.length}</span>
          )}
        </div>
        {revenueRisk.topRisks.length > 0 ? (
          <div className="mt-4 space-y-2">
            {revenueRisk.topRisks.slice(0, 5).map((risk) => (
              <Link key={risk.leadId} href={`/leads/${risk.leadId}`} className="flex items-center justify-between gap-3 inset-row px-3 py-2 text-sm transition hover:border-brand/40">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {risk.leadName ?? "Unnamed lead"}{" "}
                    {recoveryActionByLead.get(risk.leadId)?.actionType && (
                      <span className="ml-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
                        {recoveryActionLabel[recoveryActionByLead.get(risk.leadId)!.actionType!] ?? ""}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate">{risk.reasons[0] ?? ""}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold text-brand">{risk.revenueAtRisk != null ? formatInr(risk.revenueAtRisk) : "—"}</p>
                  <p className="text-[11px] uppercase tracking-[0.1em] text-slate">{risk.riskLevel} · {risk.riskScore}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate">No leads are currently showing meaningful loss-risk signals.</p>
        )}
        {nextBest.actions.filter((a) => a.action !== "NO_ACTION" && a.action !== "WAIT_AND_MONITOR").length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-semibold text-ink">Next best actions</h3>
            <div className="mt-3 space-y-2">
              {nextBest.actions
                .filter((a) => a.action !== "NO_ACTION" && a.action !== "WAIT_AND_MONITOR")
                .slice(0, 3)
                .map((a) => (
                  <Link key={a.leadId} href={`/leads/${a.leadId}`} className="flex items-center justify-between gap-3 inset-row px-3 py-2 text-sm transition hover:border-brand/40">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{a.leadName ?? "Unnamed lead"}</p>
                      <p className="truncate text-xs text-slate">{a.reason}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold text-brand">{a.action.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</p>
                      <p className="text-[11px] uppercase tracking-[0.1em] text-slate">{a.priority}/100 · {a.confidence}</p>
                    </div>
                  </Link>
                ))}
            </div>
          </div>
        )}
      </div>

      {counts.total === 0 && (
        <div className="panel-surface p-8 text-center text-sm text-slate">
          No leads yet. Share your website chat or connect WhatsApp to start receiving enquiries — they will appear here with AI scores.
        </div>
      )}

      <div className="panel-surface p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-ink">Team leakage</h2>
          <p className="text-sm text-slate">Factual workload per team member — no rankings, just operational counts.</p>
        </div>
        {intel.agentTable.length > 0 ? (
          <div className="space-y-2">
            {intel.agentTable.map((agent) => (
              <div key={agent.agentId} className="inset-row flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-ink">{agent.agentName}</p>
                  {agent.needsAttention && (
                    <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-danger">
                      Needs attention
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate">
                  {agent.activeLeads} active · {agent.atRiskLeads} at risk · {agent.overdueFollowUps} overdue · {agent.openTasks} open tasks
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate">No team workload to show yet.</p>
        )}
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">Where risk concentrates</h3>
          <div className="mt-2 space-y-1.5 text-sm text-slate">
            {intel.leakage.byStage.slice(0, 3).map((slice) => (
              <p key={slice.key}>
                <span className="font-medium text-ink">{formatInr(slice.revenue)}</span> potential value sits in stage “{slice.key}” ({slice.count} lead{slice.count === 1 ? "" : "s"}).
              </p>
            ))}
            <p>
              <span className="font-medium text-ink">{formatInr(intel.leakage.withoutSiteVisit.revenue)}</span> potential value has no site visit scheduled ({intel.leakage.withoutSiteVisit.count} lead{intel.leakage.withoutSiteVisit.count === 1 ? "" : "s"}).
            </p>
            <p>{intel.leakage.highRiskOverdueFollowUps} high-risk lead{intel.leakage.highRiskOverdueFollowUps === 1 ? " has" : "s have"} an overdue follow-up.</p>
          </div>
        </div>
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-ink">Recovery activity</h3>
          <p className="mt-2 text-sm text-slate">
            {intel.recoveryActivity.pendingFollowUps} pending follow-ups · {intel.recoveryActivity.sentFollowUpsLast30Days} sent in the last 30 days · {intel.recoveryActivity.openTasks} open agent tasks · {intel.recoveryActivity.escalations} open escalations.
          </p>
          <p className="mt-2 text-xs text-slate">{intel.honestyNote}</p>
        </div>
      </div>

      <div className="panel-surface p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-ink">Revenue Recovery Autopilot</h2>
            <p className="text-sm text-slate">Deterministic leak detection over recorded activity — attempts and outcomes, never fabricated revenue.</p>
          </div>
          <Link href="/recovery" className="ghost-btn text-brand">
            Open recovery
          </Link>
        </div>
        <p className="mt-3 text-sm text-slate">
          {recovery.candidates.length} leak{recovery.candidates.length === 1 ? "" : "s"} with a recommended action · {intel.recoveryActivity.sentFollowUpsLast30Days} follow-ups sent in the last 30 days · {intel.recoveryActivity.openTasks} open agent tasks. No recovered-revenue figure is shown — Basera does not record payment evidence.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="panel-surface p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">Conversion funnel</h2>
            <p className="text-sm text-slate">Leads → contacted → qualified → site visit → conversion</p>
          </div>
          <FunnelChart data={funnel} />
        </div>

        <div className="panel-surface p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">Leads over time</h2>
            <p className="text-sm text-slate">Last 30 days</p>
          </div>
          <TrendChart data={overTime as any} />
        </div>

        <div className="panel-surface p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">Lead source</h2>
          </div>
          <SourcePie data={bySource as any} />
        </div>

        <div className="panel-surface p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-ink">Lead temperature mix</h2>
          </div>
          <TemperatureBar hot={counts.byTemp["HOT"] ?? 0} warm={counts.byTemp["WARM"] ?? 0} cold={counts.byTemp["COLD"] ?? 0} />
        </div>
      </div>
    </div>
  );
}
