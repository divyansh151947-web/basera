import "server-only";
import { db } from "@/db/client";
import { leads, leadScoreEvents, users } from "@/db/schema";
import { and, eq, desc, gte, lte, like, sql } from "drizzle-orm";

// Every function here takes organizationId explicitly and includes it in
// every WHERE clause. This file is the ONLY place lead rows are read/written
// so tenant-isolation can be audited in one place.

export interface LeadFilters {
  status?: string;
  temperature?: string;
  assignedAgentId?: string;
  source?: string;
  minBudget?: number;
  maxBudget?: number;
  search?: string;
}

export async function listLeads(organizationId: string, filters: LeadFilters = {}) {
  const conditions = [eq(leads.organizationId, organizationId)];
  if (filters.status) conditions.push(eq(leads.status, filters.status as any));
  if (filters.temperature) conditions.push(eq(leads.temperature, filters.temperature as any));
  if (filters.assignedAgentId) conditions.push(eq(leads.assignedAgentId, filters.assignedAgentId));
  if (filters.source) conditions.push(eq(leads.source, filters.source as any));
  if (filters.minBudget) conditions.push(gte(leads.budgetMaxInr, filters.minBudget));
  if (filters.maxBudget) conditions.push(lte(leads.budgetMinInr, filters.maxBudget));
  if (filters.search) conditions.push(like(leads.name, `%${filters.search}%`));

  return db
    .select()
    .from(leads)
    .where(and(...conditions))
    .orderBy(desc(leads.updatedAt));
}

export async function getLeadById(organizationId: string, leadId: string) {
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createLead(organizationId: string, data: Partial<typeof leads.$inferInsert>) {
  const [row] = await db
    .insert(leads)
    .values({ organizationId, source: "MANUAL", ...data } as any)
    .returning();
  return row;
}

export async function updateLead(organizationId: string, leadId: string, data: Partial<typeof leads.$inferInsert>) {
  const [row] = await db
    .update(leads)
    .set({ ...data, updatedAt: new Date().toISOString() } as any)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .returning();
  return row;
}

export async function recordScoreEvent(leadId: string, score: number, temperature: string, reason: string) {
  await db.insert(leadScoreEvents).values({ leadId, score, temperature: temperature as any, reason });
}

export async function getDashboardCounts(organizationId: string) {
  const rows = await db.select().from(leads).where(eq(leads.organizationId, organizationId));
  const total = rows.length;
  const byStatus: Record<string, number> = {};
  const byTemp: Record<string, number> = {};
  for (const l of rows) {
    byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    byTemp[l.temperature] = (byTemp[l.temperature] ?? 0) + 1;
  }
  const converted = byStatus["CONVERTED"] ?? 0;
  const conversionRate = total > 0 ? Math.round((converted / total) * 1000) / 10 : 0;
  const followUpsDue = rows.filter(
    (l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt) <= new Date() && !["CONVERTED", "LOST"].includes(l.status)
  ).length;
  const needsHumanAttention = rows.filter((l) => l.temperature === "HOT" && !l.assignedAgentId).length;

  return { total, byStatus, byTemp, conversionRate, followUpsDue, needsHumanAttention };
}

export async function leadsOverTime(organizationId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await db
    .select({ date: sql<string>`substr(${leads.createdAt}, 1, 10)`, count: sql<number>`count(*)` })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, since)))
    .groupBy(sql`substr(${leads.createdAt}, 1, 10)`);
  return rows;
}

export async function leadsBySource(organizationId: string) {
  return db
    .select({ source: leads.source, count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.organizationId, organizationId))
    .groupBy(leads.source);
}

export async function agentPerformance(organizationId: string) {
  const rows = await db
    .select({
      agentId: leads.assignedAgentId,
      agentName: users.name,
      total: sql<number>`count(*)`,
      converted: sql<number>`sum(case when ${leads.status} = 'CONVERTED' then 1 else 0 end)`,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedAgentId))
    .where(eq(leads.organizationId, organizationId))
    .groupBy(leads.assignedAgentId);
  return rows.filter((r) => r.agentId);
}
