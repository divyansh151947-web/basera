import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createLead, getLeadById } from "@/lib/data/leads";
import { getPublicPropertyById } from "@/lib/data/properties";
import { formatInr } from "@/lib/formatters";
import { getOrCreateConversationForLead, getConversation, getMessages, addMessage, setConversationStatus } from "@/lib/data/conversations";
import { processInboundMessage } from "@/lib/ai/conversation-agent";
import { detectsHumanRequest, detectsLegalSensitive } from "@/lib/ai/handoff";
import {
  chatConversationTurnLimiter,
  chatIpDayLimiter,
  chatIpMinuteLimiter,
  chatNewConversationLimiter,
  getClientIp,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import { z } from "zod";

/**
 * PUBLIC endpoint used by the website chat widget (Section 13/14 channel).
 * No session auth — instead scoped by organization SLUG (public, non-secret)
 * resolved server-side, and the lead only ever sees/creates their OWN
 * lead+conversation rows (never someone else's, since a fresh visitor has no
 * conversationId until this endpoint hands one back).
 *
 * Abuse protection (Batch 1B-1) is multi-dimensional and runs BEFORE any
 * expensive work: per-IP burst + daily budgets gate every turn, new
 * conversation (lead) creation has its own daily per-IP budget, and each
 * conversation has a daily turn ceiling so one thread cannot burn unbounded
 * AI calls. Buckets are in-memory (see src/lib/rate-limit.ts for the
 * production distributed-limiter requirement). Session binding and tenant
 * isolation below are unchanged.
 */

const bodySchema = z.object({
  orgSlug: z.string(),
  content: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
  leadId: z.string().optional(),
  // Optional: present when the widget was opened from a property detail page.
  propertyId: z.string().max(128).optional(),
});

/**
 * Builds the verified-data block for a property-scoped turn. The property is
 * re-fetched and eligibility-checked server-side (not archived, AVAILABLE,
 * basera/demo orgs) so a client-supplied id can never inject another tenant's
 * or a hidden listing into the model context.
 */
function buildPropertyContext(property: NonNullable<Awaited<ReturnType<typeof getPublicPropertyById>>>): string {
  const p = property.property;
  const lines = [
    "PROPERTY THE CUSTOMER IS CURRENTLY VIEWING (verified):",
    `- id: ${p.id}`,
    `- project: ${p.projectName}${p.developer ? ` (by ${p.developer})` : ""}`,
    `- type: ${p.propertyType}${p.bhk ? `, ${p.bhk} BHK` : ""}`,
    `- location: ${p.locality}, ${p.city}`,
    `- price: ${formatInr(p.priceMinInr)}${p.priceMaxInr !== p.priceMinInr ? ` – ${formatInr(p.priceMaxInr)}` : ""}`,
    `- area: ${p.areaSqft ? `${p.areaSqft} sqft` : "not specified"}`,
    `- furnishing: ${p.furnishing ?? "not specified"}`,
    `- possession: ${p.possessionDate ?? "not specified"}`,
    `- availability: ${p.availability}`,
    `- amenities: ${p.amenitiesJson ?? "[]"} (JSON array)`,
    "- The customer arrived from this property's page: treat questions like \"this property\", \"this flat\", \"price here\" as referring to it. Still only state values listed above.",
  ];
  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  // H-3: never trust the raw client-supplied X-Forwarded-For value.
  // getClientIp() keys on the last (nearest-proxy) entry instead.
  const ip = getClientIp(req.headers);
  const minuteCheck = await chatIpMinuteLimiter.check(`chat:ip-minute:${ip}`);
  if (!minuteCheck.allowed) return rateLimitedResponse(minuteCheck.retryAfterMs);
  const dayCheck = await chatIpDayLimiter.check(`chat:ip-day:${ip}`);
  if (!dayCheck.allowed) return rateLimitedResponse(dayCheck.retryAfterMs);

  const body = await req.json().catch(() => null);
  // Malformed bodies are a controlled 400 (never a 500): the widget always
  // sends JSON, so anything else is a broken or abusive client.
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { orgSlug, content, conversationId, leadId, propertyId } = parsed.data;

  const org = (await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1))[0];
  if (!org) {
    // Diagnostic (no secrets): the deployed public workspace slug has no
    // organization row — the #1 cause of a totally dead public chat.
    console.warn("[public/chat] public workspace not found in database", { orgSlug });
    return NextResponse.json({ error: "Unknown business", code: "ORG_NOT_FOUND", orgSlug }, { status: 404 });
  }

  // Resolve + verify the property context before any conversation work: an
  // unknown/hidden/ineligible id is a controlled 404 (never silently used).
  let propertyContext: string | null = null;
  if (propertyId) {
    const propertyData = await getPublicPropertyById(propertyId);
    if (!propertyData) return NextResponse.json({ error: "Property not found or not available" }, { status: 404 });
    propertyContext = buildPropertyContext(propertyData);
  }

  let resolvedLeadId = leadId;
  let resolvedConversationId = conversationId;

  if (!resolvedLeadId) {
    const lead = await createLead(org.id, { source: "WEBSITE_CHAT" });
    resolvedLeadId = lead.id;
  } else {
    const lead = await getLeadById(org.id, resolvedLeadId);
    if (!lead) return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  if (!resolvedConversationId) {
    // M-7: cap lead/conversation farming BEFORE creating rows. Checked once
    // per fresh session (not per branch). Legitimate first-time visitors (a
    // handful of sessions per day) never notice this budget.
    const newConvoCheck = await chatNewConversationLimiter.check(`chat:new-convo:${ip}`);
    if (!newConvoCheck.allowed) return rateLimitedResponse(newConvoCheck.retryAfterMs);
    const conversation = await getOrCreateConversationForLead(org.id, resolvedLeadId, "WEBSITE_CHAT");
    resolvedConversationId = conversation.id;
  } else {
    const conversation = await getConversation(org.id, resolvedConversationId);
    if (!conversation) return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    // Bind the session: the conversation must belong to the presented lead,
    // otherwise one visitor could read or write another visitor's thread.
    if (conversation.leadId !== resolvedLeadId) {
      return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    }

    const isHumanRequest = detectsHumanRequest(content) || detectsLegalSensitive(content);
    if (conversation.status === "HUMAN_HANDLING" && !isHumanRequest) {
      // Recover from a stale or false-positive handoff instead of poisoning the chat.
      await setConversationStatus(org.id, resolvedConversationId, "AI_HANDLING");
    } else if (conversation.status === "HUMAN_HANDLING" && isHumanRequest) {
      await addMessage(resolvedConversationId, "LEAD", content);
      return NextResponse.json({
        leadId: resolvedLeadId,
        conversationId: resolvedConversationId,
        reply: "I’ve routed your request to a property specialist and they’ll follow up shortly.",
        status: "HUMAN_HANDLING",
        aiStatus: "fallback" as const,
      });
    }
  }

  // Per-conversation daily turn ceiling: bounds AI spend on any single
  // thread. Checked AFTER session binding (so it applies to the verified
  // conversation) but BEFORE processInboundMessage (the expensive AI work).
  // 60 turns/day is far beyond normal use (a long buying conversation is a
  // dozen turns); capped visitors get a human-handover pointer, not a wall.
  const turnCheck = await chatConversationTurnLimiter.check(`chat:turns:${resolvedConversationId}`);
  if (!turnCheck.allowed) {
    return NextResponse.json({
      leadId: resolvedLeadId,
      conversationId: resolvedConversationId,
      reply: "This chat has reached today's message limit. Please try again tomorrow, or say “talk to an agent” and a property specialist will pick up right away.",
      status: "AI_HANDLING",
      aiStatus: "fallback",
    });
  }

  try {
    const result = await processInboundMessage(org.id, resolvedConversationId, resolvedLeadId, content, { propertyContext });
    return NextResponse.json({
      leadId: resolvedLeadId,
      conversationId: resolvedConversationId,
      reply: result.reply,
      status: result.handoff.triggered ? "HUMAN_HANDLING" : "AI_HANDLING",
      aiStatus: result.aiStatus,
      propertyId: propertyId ?? undefined,
    });
  } catch (error) {
    // Never log visitor identifiers or message content: UUIDs are bearer
    // tokens for the cookieless widget and content may hold PII.
    console.error("[public/chat] processing failed", {
      orgSlug,
      error: error instanceof Error ? error.message : "unknown",
    });

    const safeReply = "I didn’t quite catch that. Tell me the city, BHK, or budget you’re considering, and I’ll continue from there.";
    try {
      await addMessage(resolvedConversationId, "AI", safeReply, { metadata: { errorRecovery: true } });
    } catch {
      // The recovery write itself failed (e.g. transient DB issue) — still
      // return a usable JSON reply with the session so the visitor's next
      // message continues the same conversation instead of a blank 500.
    }
    return NextResponse.json({
      leadId: resolvedLeadId,
      conversationId: resolvedConversationId,
      reply: safeReply,
      status: "AI_HANDLING",
      aiStatus: "fallback" as const,
    });
  }
}

export async function GET(req: NextRequest) {
  // Rehydrate is bearer-token read (conversationId+leadId); rate-limit like
  // POST so threads cannot be scraped at will.
  const ip = getClientIp(req.headers);
  const minuteCheck = await chatIpMinuteLimiter.check(`chat:ip-minute:${ip}`);
  if (!minuteCheck.allowed) return rateLimitedResponse(minuteCheck.retryAfterMs);
  // Lets the widget rehydrate an existing conversation's message history.
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const leadId = req.nextUrl.searchParams.get("leadId");
  const orgSlug = req.nextUrl.searchParams.get("orgSlug");
  if (!conversationId || !orgSlug || !leadId) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const org = (await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1))[0];
  if (!org) {
    console.warn("[public/chat] public workspace not found in database", { orgSlug });
    return NextResponse.json({ error: "Unknown business", code: "ORG_NOT_FOUND", orgSlug }, { status: 404 });
  }

  const conversation = await getConversation(org.id, conversationId);
  if (!conversation || conversation.leadId !== leadId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const messages = await getMessages(conversationId);
  return NextResponse.json({ messages });
}
