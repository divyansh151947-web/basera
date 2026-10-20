import "server-only";
import { db } from "@/db/client";
import {
  appointments,
  followUps,
  organizations,
  notifications,
  knowledgeDocuments,
  aiConfigs,
  scoringConfigs,
  users,
  subscriptions,
  plans,
} from "@/db/schema";
import { and, eq, desc, asc, lte } from "drizzle-orm";

// ---------------- Appointments ----------------
export async function listAppointments(organizationId: string, page?: { limit: number; offset: number }) {
  const q = db.select().from(appointments).where(eq(appointments.organizationId, organizationId)).orderBy(asc(appointments.scheduledAt));
  if (page) return q.limit(page.limit + 1).offset(page.offset);
  return q;
}

export async function createAppointment(organizationId: string, data: Partial<typeof appointments.$inferInsert>) {
  const { organizationId: _ignoredOrg, id: _ignoredId, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const [row] = await db.insert(appointments).values({ ...safeData, organizationId } as any).returning();
  return row;
}

export async function updateAppointment(organizationId: string, id: string, data: Partial<typeof appointments.$inferInsert>) {
  const { organizationId: _ignoredOrg, id: _ignoredId, createdAt: _ignoredCreated, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const [row] = await db
    .update(appointments)
    .set({ ...safeData, updatedAt: new Date().toISOString() } as any)
    .where(and(eq(appointments.id, id), eq(appointments.organizationId, organizationId)))
    .returning();
  return row;
}

// ---------------- Follow-ups ----------------
export async function listFollowUps(organizationId: string, status?: string) {
  const conditions = [eq(followUps.organizationId, organizationId)];
  if (status) conditions.push(eq(followUps.status, status as any));
  return db.select().from(followUps).where(and(...conditions)).orderBy(asc(followUps.scheduledFor));
}

export async function createFollowUp(organizationId: string, data: Partial<typeof followUps.$inferInsert>) {
  const { organizationId: _ignoredOrg, id: _ignoredId, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const [row] = await db.insert(followUps).values({ ...safeData, organizationId } as any).returning();
  return row;
}

export async function getDueFollowUps(nowIso: string) {
  // Cross-tenant scan used ONLY by the background scheduler (server-side cron
  // route protected by a secret — see /api/cron/followups). It still carries
  // organizationId on every row so the processor stays tenant-scoped per item.
  return db
    .select()
    .from(followUps)
    .where(and(eq(followUps.status, "PENDING"), lte(followUps.scheduledFor, nowIso)));
}

export async function markFollowUpSent(id: string) {
  await db.update(followUps).set({ status: "SENT", sentAt: new Date().toISOString() }).where(eq(followUps.id, id));
}

export async function markFollowUpStopped(id: string, reason: string) {
  await db.update(followUps).set({ status: "STOPPED", stopReason: reason }).where(eq(followUps.id, id));
}

// ---------------- Organizations / Plans / Subscriptions ----------------
export async function getOrganization(organizationId: string) {
  const rows = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return rows[0] ?? null;
}

export async function updateOrganization(organizationId: string, data: Partial<typeof organizations.$inferInsert>) {
  const { id: _ignoredId, createdAt: _ignoredCreated, slug: _ignoredSlug, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const [row] = await db
    .update(organizations)
    .set({ ...safeData, updatedAt: new Date().toISOString() } as any)
    .where(eq(organizations.id, organizationId))
    .returning();
  return row;
}

export async function listAllOrganizations() {
  // SUPER_ADMIN only — enforced by caller via requireSuperAdmin().
  return db.select().from(organizations).orderBy(desc(organizations.createdAt));
}

export async function getSubscriptionForOrg(organizationId: string) {
  const rows = await db
    .select({ sub: subscriptions, plan: plans })
    .from(subscriptions)
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPlans() {
  return db.select().from(plans).where(eq(plans.isActive, true));
}

// ---------------- Notifications ----------------
export async function createNotification(organizationId: string, data: { userId?: string; type: string; title: string; body: string }) {
  const { organizationId: _ignoredOrg, id: _ignoredId, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const [row] = await db.insert(notifications).values({ ...safeData, organizationId } as any).returning();
  return row;
}

export async function listNotifications(organizationId: string, userId?: string) {
  return db.select().from(notifications).where(eq(notifications.organizationId, organizationId)).orderBy(desc(notifications.createdAt)).limit(50);
}

// ---------------- Knowledge base ----------------
export async function listKnowledgeDocs(organizationId: string) {
  return db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.organizationId, organizationId));
}

export async function createKnowledgeDoc(organizationId: string, data: { type: string; title: string; content: string }) {
  const { organizationId: _ignoredOrg, id: _ignoredId, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const [row] = await db.insert(knowledgeDocuments).values({ ...safeData, organizationId } as any).returning();
  return row;
}

// ---------------- AI / Scoring config ----------------
export async function getAIConfig(organizationId: string) {
  const rows = await db.select().from(aiConfigs).where(eq(aiConfigs.organizationId, organizationId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertAIConfig(organizationId: string, data: Partial<typeof aiConfigs.$inferInsert>) {
  const { organizationId: _ignoredOrg, id: _ignoredId, createdAt: _ignoredCreated, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const existing = await getAIConfig(organizationId);
  if (existing) {
    const [row] = await db.update(aiConfigs).set({ ...safeData, updatedAt: new Date().toISOString() } as any).where(eq(aiConfigs.organizationId, organizationId)).returning();
    return row;
  }
  const [row] = await db.insert(aiConfigs).values({ ...safeData, organizationId } as any).returning();
  return row;
}

export async function getScoringConfig(organizationId: string) {
  const rows = await db.select().from(scoringConfigs).where(eq(scoringConfigs.organizationId, organizationId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertScoringConfig(organizationId: string, data: Partial<typeof scoringConfigs.$inferInsert>) {
  const { organizationId: _ignoredOrg, id: _ignoredId, createdAt: _ignoredCreated, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const existing = await getScoringConfig(organizationId);
  if (existing) {
    const [row] = await db.update(scoringConfigs).set({ ...safeData, updatedAt: new Date().toISOString() } as any).where(eq(scoringConfigs.organizationId, organizationId)).returning();
    return row;
  }
  const [row] = await db.insert(scoringConfigs).values({ weightsJson: "{}", ...safeData, organizationId } as any).returning();
  return row;
}

// ---------------- Users (team) ----------------
export async function listTeam(organizationId: string) {
  return db.select().from(users).where(eq(users.organizationId, organizationId));
}
