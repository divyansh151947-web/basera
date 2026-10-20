import "server-only";
import { eq, and, inArray, sql, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { followUps, leads, notifications, tasks, users } from "@/db/schema";
import {
  getOrganizationRevenueRisk,
  type OrgRevenueRisk,
} from "./revenue-at-risk";
import {
  getOrganizationRecoveryCandidates,
  type RecoveryCandidates,
} from "./recovery-engine";
import {
  getOrganizationNextBestActions,
  type NbaOrgResult,
} from "./next-best-action";

/**
 * REVENUE INTELLIGENCE (Money-First Batch 4, V1).
 *
 * A management-level aggregation layer. It performs NO scoring of its own:
 * every risk number comes from getOrganizationRevenueRisk, every recovery
 * figure from getOrganizationRecoveryCandidates, every recommendation from
 * getOrganizationNextBestActions. This module only joins those outputs with
 * a small set of bounded, organization-scoped reads (pipeline leads,
 * follow-ups, tasks, notifications, roster) to answer: how much is at risk,
 * what needs attention, what the team is doing, and where leakage clusters.
 *
 * HONESTY RULES (no fabrication, ever):
 * - Money shown is always "potential transaction value associated with
 *   at-risk leads" as computed by the risk engine — never loss, never won.
 * - There is NO "revenue recovered" metric: message sends, tasks, and
 *   visits are activity, not payment evidence. CONVERTED status alone is a
 *   CRM stage, not proof of collected money, so no realized-revenue number
 *   is derived from it either. The honesty note below is surfaced in UI.
 * - No historical trends: Basera stores no revenue snapshots, so only
 *   current-state metrics are reported. Backfilled "history" would be fake.
 * - Agent rows are factual operational counts (assigned, at-risk, overdue,
 *   open tasks). No best/worst ranking is computed.
 *
 * TENANT + ROLE CONTRACT (mirrors Batch 1B-4): callers pass
 * assignedAgentId for agent-scoped views (own + unassigned leads only);
 * managers omit it for the full pipeline. Organization ID always comes
 * from the server session at the call site, never from these options.
 */

export interface AgentIntelRow {
  agentId: string;
  agentName: string;
  role: string;
  activeLeads: number;
  atRiskLeads: number;
  criticalLeads: number;
  overdueFollowUps: number;
  openTasks: number;
  needsAttention: boolean;
}

export interface LeakageSlice {
  key: string;
  count: number;
  revenue: number;
}

export interface RecoveryActivity {
  pendingFollowUps: number;
  sentFollowUpsLast30Days: number;
  openTasks: number;
  unreadRecoveryNotifications: number;
  /** Open tasks titled as escalations. Count of rows, not outcomes. */
  escalations: number;
}

export interface RevenueIntelligence {
  calculatedAt: string;
  scopedToAgentId: string | null;
  overview: {
    totalRevenueAtRisk: number;
    riskyLeads: number;
    criticalLeads: number;
    recoveryCandidates: number;
    pendingActions: number;
  };
  risk: OrgRevenueRisk;
  recovery: RecoveryCandidates;
  nextBest: NbaOrgResult;
  agentTable: AgentIntelRow[];
  leakage: {
    byStage: LeakageSlice[];
    bySource: LeakageSlice[];
    withoutSiteVisit: { count: number; revenue: number };
    highRiskOverdueFollowUps: number;
  };
  recoveryActivity: RecoveryActivity;
  honestyNote: string;
}

export const REVENUE_RECOVERED_HONESTY_NOTE =
  "Revenue recovered tracking requires confirmed deal outcomes. Follow-ups, tasks, and visits below are recovery activity — not collected revenue.";

const CLOSED = ["CONVERTED", "LOST"];

export interface IntelligenceOptions {
  now?: Date | number;
  /** Agent-scoped view (own + unassigned). Omit for manager-wide view. */
  assignedAgentId?: string | null;
}

export async function getRevenueIntelligence(
  organizationId: string,
  opts: IntelligenceOptions = {}
): Promise<RevenueIntelligence> {
  const nowMs = opts.now == null ? Date.now() : typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const calculatedAt = new Date(nowMs).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  const thirtyDaysAgo = new Date(nowMs - 30 * 86_400_000).toISOString();
  const scope = opts.assignedAgentId !== undefined ? { assignedAgentId: opts.assignedAgentId } : {};

  const [risk, recovery, nextBest] = await Promise.all([
    getOrganizationRevenueRisk(organizationId, { now: nowMs, topLimit: 20, ...scope }),
    getOrganizationRecoveryCandidates(organizationId, { now: nowMs, limit: 10, ...scope }),
    getOrganizationNextBestActions(organizationId, { now: nowMs, limit: 10, ...scope }),
  ]);

  const riskByLead = new Map(risk.topRisks.map((r) => [r.leadId, r]));
  const atRiskIds = new Set(risk.topRisks.map((r) => r.leadId));

  // Build pipeline lead query with scope - only fetch pipeline leads, not all leads
  const pipelineConditions = [
    eq(leads.organizationId, organizationId),
    ne(leads.status, "CONVERTED"),
    ne(leads.status, "LOST"),
    eq(leads.optedOut, false),
  ];
  if (opts.assignedAgentId !== undefined) {
    pipelineConditions.push(sql`(${leads.assignedAgentId} IS NULL OR ${leads.assignedAgentId} = ${opts.assignedAgentId})`);
  }

  const pipelineLeads = await db
    .select({
      id: leads.id,
      status: leads.status,
      source: leads.source,
      assignedAgentId: leads.assignedAgentId,
    })
    .from(leads)
    .where(and(...pipelineConditions));

  const pipeline = pipelineLeads;
  const pipelineIds = new Set(pipelineLeads.map((l) => l.id));
  const pipelineIdArray = Array.from(pipelineIds);

  // Fetch only follow-ups for pipeline leads
  const fuRows = pipelineIdArray.length > 0
    ? await db.select().from(followUps).where(and(eq(followUps.organizationId, organizationId), inArray(followUps.leadId, pipelineIdArray)))
    : [];

  // Fetch only tasks for pipeline leads (or unassigned tasks)
  const taskRows = pipelineIdArray.length > 0
    ? await db.select().from(tasks).where(and(eq(tasks.organizationId, organizationId), sql`(${tasks.leadId} IS NULL OR ${tasks.leadId} IN ${pipelineIdArray})`))
    : await db.select().from(tasks).where(and(eq(tasks.organizationId, organizationId), sql`${tasks.leadId} IS NULL`));

  // Fetch notifications
  const notifRows = opts.assignedAgentId
    ? await db.select().from(notifications).where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, opts.assignedAgentId)))
    : opts.assignedAgentId === null
      ? await db.select().from(notifications).where(and(eq(notifications.organizationId, organizationId), sql`${notifications.userId} IS NULL`))
      : await db.select().from(notifications).where(eq(notifications.organizationId, organizationId));

  // Fetch team roster
  const teamRows = opts.assignedAgentId
    ? await db.select().from(users).where(and(eq(users.organizationId, organizationId), eq(users.id, opts.assignedAgentId)))
    : await db.select().from(users).where(and(eq(users.organizationId, organizationId), ne(users.role, "SUPER_ADMIN")));

  const visibleFus = fuRows.filter((f) => pipelineIds.has(f.leadId));
  const visibleTasks = taskRows.filter((t) => t.leadId == null || pipelineIds.has(t.leadId));
  const openTasks = visibleTasks.filter((t) => !t.isDone);
  const pendingFus = visibleFus.filter((f) => f.status === "PENDING");
  const sent30d = visibleFus.filter(
    (f) => f.status === "SENT" && f.sentAt != null && nowMs - new Date(f.sentAt).getTime() <= 30 * 86_400_000
  );
  const unreadRecovery = notifRows.filter((n) => n.type === "RECOVERY_ACTION" && !n.isRead);
  const escalations = openTasks.filter((t) => t.title.startsWith("Escalated"));

  // Agent table
  const roster = opts.assignedAgentId !== undefined
    ? teamRows.filter((u) => u.id === opts.assignedAgentId)
    : teamRows.filter((u) => u.role !== "SUPER_ADMIN");
  
  const agentTable: AgentIntelRow[] = roster.map((member) => {
    const mine = pipeline.filter((l) => l.assignedAgentId === member.id);
    const mineIds = new Set(mine.map((l) => l.id));
    const atRisk = mine.filter((l) => atRiskIds.has(l.id));
    const overdue = visibleFus.filter(
      (f) =>
        mineIds.has(f.leadId) &&
        ((f.status === "PENDING" && f.scheduledFor <= calculatedAt) || f.status === "FAILED")
    ).length;
    const mineOpenTasks = openTasks.filter((t) => t.assigneeId === member.id).length;
    const critical = atRisk.filter((l) => riskByLead.get(l.id)?.riskLevel === "CRITICAL").length;
    return {
      agentId: member.id,
      agentName: member.name,
      role: member.role,
      activeLeads: mine.length,
      atRiskLeads: atRisk.length,
      criticalLeads: critical,
      overdueFollowUps: overdue,
      openTasks: mineOpenTasks,
      needsAttention: overdue > 0 || critical > 0,
    };
  });

  // Leakage
  const atRiskLeads = pipeline.filter((l) => atRiskIds.has(l.id));
  const slice = (keyOf: (l: typeof pipeline[number]) => string): LeakageSlice[] => {
    const map = new Map<string, { count: number; revenue: number }>();
    for (const lead of atRiskLeads) {
      const key = keyOf(lead) || "Unknown";
      const entry = map.get(key) ?? { count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += riskByLead.get(lead.id)?.revenueAtRisk ?? 0;
      map.set(key, entry);
    }
    const out: LeakageSlice[] = [];
    map.forEach((v, key) => out.push({ key, count: v.count, revenue: v.revenue }));
    return out.sort((a, b) => b.revenue - a.revenue || b.count - a.count);
  };
  const withoutSiteVisit = atRiskLeads.filter((l) => {
    const r = riskByLead.get(l.id);
    return r != null && (r.appointmentStatus === "NONE" || r.appointmentStatus == null);
  });
  const leakage = {
    byStage: slice((l) => l.status.replace(/_/g, " ").toLowerCase()),
    bySource: slice((l) => l.source),
    withoutSiteVisit: {
      count: withoutSiteVisit.length,
      revenue: withoutSiteVisit.reduce((s, l) => s + (riskByLead.get(l.id)?.revenueAtRisk ?? 0), 0),
    },
    highRiskOverdueFollowUps: atRiskLeads.filter((l) => {
      const r = riskByLead.get(l.id);
      return r != null && (r.riskLevel === "HIGH" || r.riskLevel === "CRITICAL") && r.followUpStatus === "OVERDUE";
    }).length,
  };

  const riskyCount = atRiskLeads.length;
  const criticalCount = atRiskLeads.filter((l) => riskByLead.get(l.id)?.riskLevel === "CRITICAL").length;

  return {
    calculatedAt,
    scopedToAgentId: opts.assignedAgentId ?? null,
    overview: {
      totalRevenueAtRisk: risk.totalRevenueAtRisk,
      riskyLeads: riskyCount,
      criticalLeads: criticalCount,
      recoveryCandidates: recovery.candidates.length,
      pendingActions: pendingFus.length + openTasks.length,
    },
    risk,
    recovery,
    nextBest,
    agentTable,
    leakage,
    recoveryActivity: {
      pendingFollowUps: pendingFus.length,
      sentFollowUpsLast30Days: sent30d.length,
      openTasks: openTasks.length,
      unreadRecoveryNotifications: unreadRecovery.length,
      escalations: escalations.length,
    },
    honestyNote: REVENUE_RECOVERED_HONESTY_NOTE,
  };
}
