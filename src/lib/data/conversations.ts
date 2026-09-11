import "server-only";
import { db } from "@/db/client";
import { conversations, messages, leads } from "@/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";

export async function listConversations(organizationId: string, filters: { status?: string } = {}) {
  const conditions = [eq(conversations.organizationId, organizationId)];
  if (filters.status) conditions.push(eq(conversations.status, filters.status as any));
  return db.select().from(conversations).where(and(...conditions)).orderBy(desc(conversations.updatedAt));
}

export async function getConversation(organizationId: string, conversationId: string) {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOrCreateConversationForLead(
  organizationId: string,
  leadId: string,
  channel: string
) {
  const existing = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.leadId, leadId), eq(conversations.status, "AI_HANDLING")))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  if (existing[0]) return existing[0];

  const [row] = await db
    .insert(conversations)
    .values({ organizationId, leadId, channel: channel as any })
    .returning();
  return row;
}

export async function getMessages(conversationId: string) {
  return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
}

export async function addMessage(
  conversationId: string,
  sender: "LEAD" | "AI" | "AGENT" | "SYSTEM",
  content: string,
  opts: { senderUserId?: string; language?: string; metadata?: Record<string, unknown> } = {}
) {
  const [row] = await db
    .insert(messages)
    .values({
      conversationId,
      sender,
      content,
      senderUserId: opts.senderUserId,
      language: opts.language,
      metadataJson: opts.metadata ? JSON.stringify(opts.metadata) : null,
    })
    .returning();
  await db.update(conversations).set({ updatedAt: new Date().toISOString() }).where(eq(conversations.id, conversationId));
  return row;
}

export async function setConversationStatus(
  organizationId: string,
  conversationId: string,
  status: "AI_HANDLING" | "HUMAN_HANDLING" | "CLOSED",
  handoffReason?: string
) {
  const [row] = await db
    .update(conversations)
    .set({ status, handoffReason, updatedAt: new Date().toISOString() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)))
    .returning();
  return row;
}
