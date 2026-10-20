import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { canManageAllLeads } from "@/lib/lead-access";
import { getRecoveryAutopilot } from "@/lib/revenue-recovery-autopilot";
import { formatInr } from "@/lib/formatters";
import { StatCard } from "@/components/ui";
import { RecoveryLeakButtons } from "./recovery-leak-buttons";

function hoursLabel(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return "under an hour";
  if (h < 24) return `${Math.max(1, Math.round(h))}h`;
  return `${Math.max(1, Math.floor(h / 24))}d`;
}

const STATUS_STYLES: Record<string, string> = {
  ACTION_NEEDED: "bg-danger-soft text-danger",
  MONITORING: "bg-paper text-slate",
  IN_PROGRESS: "bg-brand-soft text-brand",
  DISMISSED: "bg-paper text-slate",
};

export default async function RecoveryAutopilotPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;
  const role = (session.user as any).role as string;
  const userId = (session.user as any).id as string;
  const isManager = canManageAllLeads(role);

  const autopilot = await getRecoveryAutopilot(
    organizationId,
    isManager ? {} : { assignedAgentId: userId }
  );
  const { overview, leaks, outcomes, lostDeals, wonDeals } = autopilot;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="eyebrow">{isManager ? "Revenue" : "Your work"}</span>
          <h1 className="mt-3 font-display text-3xl text-ink">
            {isManager ? "Revenue Recovery" : "Your recovery actions"}
          </h1>
        </div>
        <div className="notice max-w-xl rounded-2xl">
          Deterministic leak detection over recorded activity — attempts and outcomes, never fabricated revenue.
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Tracked opportunity" value={formatInr(overview.trackedOpportunity)} />
        <StatCard label="Revenue at risk" value={formatInr(overview.revenueAtRisk)} accent="text-danger" />
        <StatCard label="Active leaks" value={overview.activeLeaks} />
        <StatCard label="Critical leaks" value={overview.criticalLeaks} accent={overview.criticalLeaks > 0 ? "text-danger" : "text-ink"} />
        <StatCard label="High-priority actions" value={overview.highPriorityActions} />
        <StatCard label="Recovery attempts" value={overview.recoveryAttempts} />
        <StatCard label="Positive outcomes" value={overview.positiveOutcomes} />
        <StatCard label="Recovery responses" value={overview.recoveryResponses} />
        <StatCard label="Site visits recovered" value={overview.siteVisitsRecovered} />
        <StatCard label="Deals won with activity" value={overview.dealsWonWithActivity} />
      </div>

      <div className="notice rounded-2xl text-xs">
        Recovered revenue is not shown because Basera does not record payment evidence — {overview.honestyNote}
      </div>

      <div className="panel-surface p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-ink">Top revenue leaks</h2>
          <p className="text-sm text-slate">Ranked urgency-first: a severe SLA breach outranks a dormant larger opportunity.</p>
        </div>
        {leaks.length > 0 ? (
          <div className="space-y-2">
            {leaks.map((leak) => (
              <div key={leak.leakId} className="rounded-xl border border-line px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/leads/${leak.leadId}`} className="min-w-0 transition hover:text-brand">
                    <p className="truncate font-medium text-ink">
                      {leak.leadName ?? "Unnamed lead"}{" "}
                      <span className="ml-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
                        {leak.type.replace(/_/g, " ")}
                      </span>{" "}
                      <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${STATUS_STYLES[leak.recoveryStatus] ?? "bg-paper text-slate"}`}>
                        {leak.recoveryStatus.replace(/_/g, " ")}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate">{leak.reason}</p>
                  </Link>
                  <RecoveryLeakButtons leadId={leak.leadId} leakType={leak.type} status={leak.recoveryStatus} />
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate">
                  <span>Stage: <span className="font-medium text-ink">{leak.stage.replace(/_/g, " ").toLowerCase()}</span></span>
                  <span>Opportunity: <span className="font-medium text-brand">{leak.opportunityValue != null ? formatInr(leak.opportunityValue) : "—"}</span></span>
                  <span>Risk: <span className="font-medium text-ink">{leak.riskLevel} · {leak.riskScore}</span></span>
                  <span>Priority: <span className="font-medium text-ink">{leak.priority}/100</span></span>
                  <span>Since last action: <span className="font-medium text-ink">{hoursLabel(leak.hoursSinceLastAction)}</span></span>
                  <span>Owner: <span className="font-medium text-ink">{leak.ownerAgentName ?? "Unassigned"}</span></span>
                </div>
                <p className="mt-1.5 text-xs text-slate">
                  Next: <span className="font-medium text-ink">{leak.recommendedAction.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                  {" "}· {leak.recommendedReason}
                </p>
                {leak.statusDetail && <p className="mt-1 text-xs text-slate">{leak.statusDetail}</p>}
                <details className="mt-1 text-xs text-slate">
                  <summary className="cursor-pointer font-medium text-brand">Why this priority</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {leak.priorityBreakdown.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                  <p className="mt-1">Evidence:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {leak.evidence.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate">No revenue leaks detected in the current recorded activity.</p>
        )}
      </div>

      <div className="panel-surface p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-ink">Recovery outcomes</h2>
          <p className="text-sm text-slate">Attempts vs outcomes. A response, appointment, or visit after an attempt is a positive outcome — not revenue.</p>
        </div>
        {outcomes.length > 0 ? (
          <div className="space-y-2">
            {outcomes.map((o) => (
              <Link key={o.leadId} href={`/leads/${o.leadId}`} className="flex items-center justify-between gap-3 inset-row px-3 py-2 text-sm transition hover:border-brand/40">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {o.leadName ?? "Unnamed lead"}{" "}
                    <span className="ml-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand">
                      {o.recoveryState.replace(/_/g, " ")}
                    </span>
                  </p>
                  <p className="truncate text-xs text-slate">{o.attemptsDetail.join(" ") || "No recovery activity on record."}</p>
                  <p className="truncate text-xs text-slate">{o.confirmationLabel}</p>
                </div>
                <p className="shrink-0 text-xs text-slate">{o.currentStatus.replace(/_/g, " ").toLowerCase()}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate">No recovery activity recorded yet.</p>
        )}
      </div>

      {(lostDeals.length > 0 || wonDeals.length > 0) && (
        <div className="grid gap-5 xl:grid-cols-2">
          {lostDeals.length > 0 && (
            <div className="panel-surface p-5">
              <h2 className="text-lg font-semibold text-ink">Lost-deal review</h2>
              <p className="text-sm text-slate">Observed facts and potential contributing factors — never proven causes.</p>
              <div className="mt-3 space-y-2">
                {lostDeals.slice(0, 5).map((d) => (
                  <details key={d.leadId} className="rounded-xl border border-line px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium text-ink">
                      <Link href={`/leads/${d.leadId}`} className="hover:text-brand">{d.leadName ?? "Unnamed lead"}</Link>
                      {" "}<span className="text-xs font-normal text-slate">{d.associatedValue != null ? formatInr(d.associatedValue) : "no value on file"}</span>
                    </summary>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate">
                      {d.observed.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs font-medium text-ink">Potential contributing factors:</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate">
                      {d.potentialContributingFactors.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          )}
          {wonDeals.length > 0 && (
            <div className="panel-surface p-5">
              <h2 className="text-lg font-semibold text-ink">Won-deal signals</h2>
              <p className="text-sm text-slate">Repeatable workflow evidence from recorded activity.</p>
              <div className="mt-3 space-y-2">
                {wonDeals.slice(0, 5).map((d) => (
                  <details key={d.leadId} className="rounded-xl border border-line px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium text-ink">
                      <Link href={`/leads/${d.leadId}`} className="hover:text-brand">{d.leadName ?? "Unnamed lead"}</Link>
                      {" "}<span className="text-xs font-normal text-slate">{d.associatedValue != null ? formatInr(d.associatedValue) : "no value on file"}</span>
                    </summary>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate">
                      {d.observed.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs font-medium text-ink">Conversion signals:</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate">
                      {d.conversionSignals.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
