import "server-only";
import { db } from "@/db/client";
import { leads, leadScoreEvents, leadPropertyInterests, properties, users } from "@/db/schema";
import { and, eq, desc, gte, lte, like, sql, count } from "drizzle-orm";
import { likeContains } from "@/lib/safe-like";

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

export async function listLeads(organizationId: string, filters: LeadFilters = {}, page?: { limit: number; offset: number }) {
  const conditions = [eq(leads.organizationId, organizationId)];
  if (filters.status) conditions.push(eq(leads.status, filters.status as any));
  if (filters.temperature) conditions.push(eq(leads.temperature, filters.temperature as any));
  if (filters.assignedAgentId) conditions.push(eq(leads.assignedAgentId, filters.assignedAgentId));
  if (filters.source) conditions.push(eq(leads.source, filters.source as any));
  if (filters.minBudget) conditions.push(gte(leads.budgetMaxInr, filters.minBudget));
  if (filters.maxBudget) conditions.push(lte(leads.budgetMinInr, filters.maxBudget));
  if (filters.search) conditions.push(like(leads.name, likeContains(filters.search)));

  // Paged reads fetch limit+1 rows (same order) so callers derive hasMore
  // without a full-table scan. Omit page for the legacy full read (used by
  // assignment-filtered agent views and analytics aggregations).
  const q = db
    .select()
    .from(leads)
    .where(and(...conditions))
    .orderBy(desc(leads.updatedAt));
  if (page) return q.limit(page.limit + 1).offset(page.offset);
  return q;
}

export async function getLeadById(organizationId: string, leadId: string) {
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getLeadByPhone(organizationId: string, phone: string) {
  const rows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), eq(leads.phone, phone)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createLead(organizationId: string, data: Partial<typeof leads.$inferInsert>) {
  // Tenant-override hardening: caller-supplied organizationId/id can never
  // escape the session tenant. The session-derived organizationId above
  // always wins, even if a future caller passes raw body data through.
  const { organizationId: _ignoredOrg, id: _ignoredId, ...safeData } = (data ?? {}) as Record<string, unknown>;
  // Ensure `score` is always set at insert time to avoid NOT NULL failures.
  // Keep it last in the object so a partial insert with an undefined `score`
  // cannot overwrite the default value in the spread object.
  const [row] = await db
    .insert(leads)
    .values({
      ...safeData,
      organizationId,
      source: (safeData as any).source ?? "MANUAL",
      score: (safeData as any)?.score ?? 0,
    } as any)
    .returning();
  return row;
}

export async function updateLead(organizationId: string, leadId: string, data: Partial<typeof leads.$inferInsert>) {
  // Sanitize update payload: remove undefined properties so we don't
  // accidentally set columns to NULL (SQLite treats undefined as NULL
  // when applied via a partial object). Always set `updatedAt`.
  // Strip tenant/identity fields so an update can never reparent a row.
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v !== undefined && k !== "organizationId" && k !== "id" && k !== "createdAt") sanitized[k] = v;
  }
  sanitized.updatedAt = new Date().toISOString();

  const [row] = await db
    .update(leads)
    .set(sanitized as any)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .returning();
  return row;
}

export async function recordScoreEvent(leadId: string, score: number, temperature: string, reason: string) {
  await db.insert(leadScoreEvents).values({ leadId, score, temperature: temperature as any, reason });
}

/** Score history for the lead profile, org-scoped through the lead row. */
export async function listLeadScoreEvents(organizationId: string, leadId: string, limit = 5) {
  return db
    .select({
      id: leadScoreEvents.id,
      score: leadScoreEvents.score,
      temperature: leadScoreEvents.temperature,
      reason: leadScoreEvents.reason,
      createdAt: leadScoreEvents.createdAt,
    })
    .from(leadScoreEvents)
    .innerJoin(leads, eq(leads.id, leadScoreEvents.leadId))
    .where(and(eq(leads.organizationId, organizationId), eq(leadScoreEvents.leadId, leadId)))
    .orderBy(desc(leadScoreEvents.createdAt))
    .limit(limit);
}

/** Saved property interests for a lead, newest-best match first. */
export async function listLeadInterests(organizationId: string, leadId: string) {
  return db
    .select({
      id: leadPropertyInterests.id,
      propertyId: leadPropertyInterests.propertyId,
      matchType: leadPropertyInterests.matchType,
      matchScore: leadPropertyInterests.matchScore,
      createdAt: leadPropertyInterests.createdAt,
      property: properties,
    })
    .from(leadPropertyInterests)
    .innerJoin(leads, eq(leads.id, leadPropertyInterests.leadId))
    .innerJoin(properties, eq(properties.id, leadPropertyInterests.propertyId))
    .where(and(eq(leads.organizationId, organizationId), eq(leadPropertyInterests.leadId, leadId)))
    .orderBy(desc(leadPropertyInterests.matchScore));
}

/**
 * Records that a property was put in front of a lead (AI recommendation or
 * agent shortlist). Re-saving the same property keeps the best match score
 * instead of creating a duplicate row.
 */
export async function upsertLeadInterest(
  organizationId: string,
  leadId: string,
  propertyId: string,
  matchType: string,
  matchScore: number
) {
  const owned = await getLeadById(organizationId, leadId);
  if (!owned) return null;

  const existing = await db
    .select()
    .from(leadPropertyInterests)
    .where(and(eq(leadPropertyInterests.leadId, leadId), eq(leadPropertyInterests.propertyId, propertyId)))
    .limit(1);

  if (existing[0]) {
    if (matchScore <= existing[0].matchScore) return existing[0];
    const [row] = await db
      .update(leadPropertyInterests)
      .set({ matchType: matchType as any, matchScore })
      .where(eq(leadPropertyInterests.id, existing[0].id))
      .returning();
    return row;
  }

  const [row] = await db
    .insert(leadPropertyInterests)
    .values({ leadId, propertyId, matchType: matchType as any, matchScore })
    .returning();
  return row;
}

/** Persists every match the customer was shown, best score wins per property. */
export async function saveMatchedInterests(
  organizationId: string,
  leadId: string,
  matches: { propertyId: string; matchType: string; matchScore: number }[]
) {
  for (const match of matches) {
    try {
      await upsertLeadInterest(organizationId, leadId, match.propertyId, match.matchType, match.matchScore);
    } catch (error) {
      console.error("[leads] failed to save property interest", { organizationId, leadId, match, error });
    }
  }
}

export async function getDashboardCounts(organizationId: string) {
  const now = new Date().toISOString();
  
  const [statusCounts, tempCounts, totalCount, followUpsDueCount, needsAttentionCount] = await Promise.all([
    db
      .select({ status: leads.status, count: count() })
      .from(leads)
      .where(eq(leads.organizationId, organizationId))
      .groupBy(leads.status),
    db
      .select({ temperature: leads.temperature, count: count() })
      .from(leads)
      .where(eq(leads.organizationId, organizationId))
      .groupBy(leads.temperature),
    db
      .select({ count: count() })
      .from(leads)
      .where(eq(leads.organizationId, organizationId)),
    db
      .select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, organizationId),
        lte(leads.nextFollowUpAt, now),
        // Exclude CONVERTED and LOST using NOT IN
        sql`${leads.status} NOT IN ('CONVERTED', 'LOST')`
      )),
    db
      .select({ count: count() })
      .from(leads)
      .where(and(
        eq(leads.organizationId, organizationId),
        eq(leads.temperature, "HOT"),
        // No assigned agent
        sql`${leads.assignedAgentId} IS NULL`
      )),
  ]);

  const byStatus: Record<string, number> = {};
  for (const s of statusCounts) {
    byStatus[s.status] = Number(s.count);
  }
  const byTemp: Record<string, number> = {};
  for (const t of tempCounts) {
    byTemp[t.temperature] = Number(t.count);
  }
  const total = Number(totalCount[0]?.count ?? 0);
  const converted = byStatus["CONVERTED"] ?? 0;
  const conversionRate = total > 0 ? Math.round((converted / total) * 1000) / 10 : 0;

  return { 
    total, 
    byStatus, 
    byTemp, 
    conversionRate, 
    followUpsDue: Number(followUpsDueCount[0]?.count ?? 0), 
    needsHumanAttention: Number(needsAttentionCount[0]?.count ?? 0) 
  };
}

export async function leadsOverTime(organizationId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  // NOTE: created_at is ISO text on both dialects, so substr() works
  // identically on SQLite and PostgreSQL. count(*) arrives as text on
  // PostgreSQL, hence the Number() normalization (harmless on SQLite).
  const rows = await db
    .select({ date: sql<string>`substr(${leads.createdAt}, 1, 10)`, count: sql<number>`count(*)` })
    .from(leads)
    .where(and(eq(leads.organizationId, organizationId), gte(leads.createdAt, since)))
    .groupBy(sql`substr(${leads.createdAt}, 1, 10)`);
  return rows.map((r) => ({ date: r.date, count: Number(r.count) }));
}

export async function leadsBySource(organizationId: string) {
  const rows = await db
    .select({ source: leads.source, count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.organizationId, organizationId))
    .groupBy(leads.source);
  return rows.map((r) => ({ source: r.source, count: Number(r.count) }));
}

export async function agentPerformance(organizationId: string) {
  // NOTE: GROUP BY lists both id and name because PostgreSQL (unlike
  // SQLite) requires every non-aggregated selected column to be grouped.
  // agentName is functionally dependent on agentId, so grouping is unchanged.
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
    .groupBy(leads.assignedAgentId, users.name);
  return rows
    .map((r) => ({ ...r, total: Number(r.total), converted: Number(r.converted) }))
    .filter((r) => r.agentId);
}
