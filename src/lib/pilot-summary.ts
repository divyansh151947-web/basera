import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { leads } from "@/db/schema";
import { getOrganization } from "./data/org";
import { getTenantAnalyticsSnapshot } from "./data/analytics";
import { getOrganizationRevenueRisk } from "./revenue-at-risk";
import { getRecoveryAutopilot } from "./revenue-recovery-autopilot";

/**
 * PILOT SUMMARY (Batch 8 Prompt 4).
 *
 * A lightweight, read-only answer to "what happened to this brokerage's
 * leads while using Basera?" It computes NOTHING of its own: lead activity
 * comes from getTenantAnalyticsSnapshot, risk from
 * getOrganizationRevenueRisk, recovery from getRecoveryAutopilot. No trends
 * are backfilled (Basera stores no revenue snapshots), no ROI percentages
 * are manufactured, and recovered revenue is never estimated.
 *
 * The reporting period uses the workspace creation date through now — never
 * a hardcoded pilot window, never fabricated history.
 */

export interface PilotSummary {
  calculatedAt: string;
  organizationId: string;
  organizationName: string | null;
  period: { start: string | null; end: string; label: string };
  leadActivity: {
    totalLeads: number;
    qualifiedLeads: number;
    activeLeads: number;
    dormantLeads: number;
    convertedLeads: number;
  };
  revenueRisk: { leadsAtRisk: number; revenueAtRisk: number };
  recovery: {
    opportunities: number;
    attempts: number;
    responses: number;
    siteVisitsRecovered: number;
    confirmedOutcomes: number;
  };
  sales: {
    wonDeals: number;
    /** ALWAYS null — confirmed collected revenue is not recorded. */
    recoveredRevenue: null;
    recoveredRevenueNote: string;
  };
  honestyNote: string;
}

function formatDayMonthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
}

export async function getPilotSummary(
  organizationId: string,
  opts: { now?: Date | number; assignedAgentId?: string | null } = {}
): Promise<PilotSummary> {
  const nowMs = opts.now == null ? Date.now() : typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const end = new Date(nowMs).toISOString();
  const scope = opts.assignedAgentId !== undefined ? { assignedAgentId: opts.assignedAgentId } : {};

  const [org, analytics, risk, autopilot, leadRows] = await Promise.all([
    getOrganization(organizationId),
    getTenantAnalyticsSnapshot(organizationId),
    getOrganizationRevenueRisk(organizationId, { now: nowMs, topLimit: 100, ...scope }),
    getRecoveryAutopilot(organizationId, { now: nowMs, limit: 25, ...scope }),
    // The single exception to "compute nothing": exact open-pipeline counts
    // by status. The analytics snapshot's pipeline omits NURTURE/LOST, so
    // active/dormant cannot be derived from it without guessing. This is one
    // bounded org-scoped status count — no scoring, no inference.
    db.select({ status: leads.status }).from(leads).where(eq(leads.organizationId, organizationId)),
  ]);

  const periodStart = org?.createdAt ?? null;
  const periodLabel =
    periodStart != null
      ? `Pilot activity: ${formatDayMonthYear(periodStart)} – ${formatDayMonthYear(end)}`
      : "Pilot activity since workspace creation (creation date not recorded)";

  const isOpen = (s: string) => s !== "CONVERTED" && s !== "LOST";
  const activeLeads = leadRows.filter((l) => isOpen(l.status)).length;
  const dormantLeads = leadRows.filter((l) => l.status === "NURTURE").length;

  return {
    calculatedAt: end,
    organizationId,
    organizationName: org?.name ?? null,
    period: { start: periodStart, end, label: periodLabel },
    leadActivity: {
      totalLeads: analytics.totalLeads,
      qualifiedLeads: analytics.qualifiedLeads,
      activeLeads,
      dormantLeads,
      convertedLeads: analytics.convertedLeads,
    },
    revenueRisk: {
      leadsAtRisk: risk.topRisks.length,
      revenueAtRisk: risk.totalRevenueAtRisk,
    },
    recovery: {
      opportunities: autopilot.overview.highPriorityActions,
      attempts: autopilot.overview.recoveryAttempts,
      responses: autopilot.overview.recoveryResponses,
      siteVisitsRecovered: autopilot.overview.siteVisitsRecovered,
      confirmedOutcomes: autopilot.overview.positiveOutcomes,
    },
    sales: {
      wonDeals: analytics.convertedLeads,
      recoveredRevenue: null,
      recoveredRevenueNote:
        "Confirmed revenue recovered: not confirmed — Basera does not record payment evidence. A won CRM stage is not proof of collected money.",
    },
    honestyNote:
      "Revenue at risk is potential transaction value on at-risk leads — it is not a measure of lost money, and it is not money in hand. It is a different metric from recovered revenue, which is only ever shown when payment evidence exists (never in this build). No historical trends are shown: Basera reports the current recorded state, not backfilled history.",
  };
}
