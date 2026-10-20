import { getPilotSummary } from "@/lib/pilot-summary";
import { formatInr } from "@/lib/formatters";

/**
 * Pilot summary panel (analytics page). Every number comes from an existing
 * aggregation (analytics snapshot, revenue-at-risk, recovery autopilot);
 * the panel only lays them out under one honest period label. Recovered
 * revenue is always reported as unconfirmed — never estimated.
 */
export async function PilotSummary({
  organizationId,
  assignedAgentId,
}: {
  organizationId: string;
  assignedAgentId?: string | null;
}) {
  const summary = await getPilotSummary(
    organizationId,
    assignedAgentId !== undefined ? { assignedAgentId } : {}
  );

  const groups: { title: string; rows: { label: string; value: string }[] }[] = [
    {
      title: "Lead activity",
      rows: [
        { label: "Total leads", value: String(summary.leadActivity.totalLeads) },
        { label: "Qualified leads", value: String(summary.leadActivity.qualifiedLeads) },
        { label: "Active leads", value: String(summary.leadActivity.activeLeads) },
        { label: "Dormant (nurture) leads", value: String(summary.leadActivity.dormantLeads) },
      ],
    },
    {
      title: "Revenue risk",
      rows: [
        { label: "Leads at risk", value: String(summary.revenueRisk.leadsAtRisk) },
        { label: "Revenue at risk", value: formatInr(summary.revenueRisk.revenueAtRisk) },
      ],
    },
    {
      title: "Recovery",
      rows: [
        { label: "Recovery opportunities", value: String(summary.recovery.opportunities) },
        { label: "Recovery attempts", value: String(summary.recovery.attempts) },
        { label: "Customer responses", value: String(summary.recovery.responses) },
        { label: "Site visits recovered", value: String(summary.recovery.siteVisitsRecovered) },
        { label: "Confirmed outcomes", value: String(summary.recovery.confirmedOutcomes) },
      ],
    },
    {
      title: "Sales",
      rows: [
        { label: "Won deals (CRM stage)", value: String(summary.sales.wonDeals) },
        { label: "Confirmed revenue recovered", value: "Not confirmed" },
      ],
    },
  ];

  return (
    <div className="panel-surface p-5">
      <div className="mb-1">
        <h2 className="text-lg font-semibold text-ink">Pilot summary</h2>
        <p className="text-sm text-slate">What happened to this workspace&apos;s leads — recorded state only, no backfilled history.</p>
        <p className="mt-1 text-xs font-medium text-slate">{summary.period.label}</p>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate">{group.title}</p>
            <dl className="mt-2 space-y-1.5">
              {group.rows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-2 text-sm">
                  <dt className="text-slate">{row.label}</dt>
                  <dd className="font-semibold text-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <p className="mt-4 border-t border-line pt-3 text-xs text-slate">{summary.honestyNote}</p>
      <p className="mt-1 text-xs text-slate">{summary.sales.recoveredRevenueNote}</p>
    </div>
  );
}
