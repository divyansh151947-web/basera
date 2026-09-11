import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createLead, getLeadById } from "@/lib/data/leads";
import { getOrCreateConversationForLead, getConversation, getMessages } from "@/lib/data/conversations";
import { processInboundMessage } from "@/lib/ai/conversation-agent";
import { z } from "zod";

/**
 * PUBLIC endpoint used by the website chat widget (Section 13/14 channel).
 * No session auth — instead scoped by organization SLUG (public, non-secret)
 * resolved server-side, and the lead only ever sees/creates their OWN
 * lead+conversation rows (never someone else's, since a fresh visitor has no
 * conversationId until this endpoint hands one back).
 *
 * Basic in-memory rate limiting per IP is included for the demo; production
 * should replace this with a distributed limiter (e.g. Redis/Upstash) since
 * in-memory state does not survive across serverless instances.
 */

const bodySchema = z.object({
  orgSlug: z.string(),
  content: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
  leadId: z.string().optional(),
});

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many messages. Please slow down." }, { status: 429 });
  }

  const body = await req.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { orgSlug, content, conversationId, leadId } = parsed.data;

  const org = (await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1))[0];
  if (!org) return NextResponse.json({ error: "Unknown business" }, { status: 404 });

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
    const conversation = await getOrCreateConversationForLead(org.id, resolvedLeadId, "WEBSITE_CHAT");
    resolvedConversationId = conversation.id;
  } else {
    const conversation = await getConversation(org.id, resolvedConversationId);
    if (!conversation) return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    if (conversation.status === "HUMAN_HANDLING") {
      // A human has taken over — still store the message, but don't let the AI reply.
      const { addMessage } = await import("@/lib/data/conversations");
      await addMessage(resolvedConversationId, "LEAD", content);
      return NextResponse.json({
        leadId: resolvedLeadId,
        conversationId: resolvedConversationId,
        reply: null,
        status: "HUMAN_HANDLING",
      });
    }
  }

  const result = await processInboundMessage(org.id, resolvedConversationId, resolvedLeadId, content);

  return NextResponse.json({
    leadId: resolvedLeadId,
    conversationId: resolvedConversationId,
    reply: result.reply,
    status: result.handoff.triggered ? "HUMAN_HANDLING" : "AI_HANDLING",
  });
}

export async function GET(req: NextRequest) {
  // Lets the widget rehydrate an existing conversation's message history.
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const orgSlug = req.nextUrl.searchParams.get("orgSlug");
  if (!conversationId || !orgSlug) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const org = (await db.select().from(organizations).where(eq(organizations.slug, orgSlug)).limit(1))[0];
  if (!org) return NextResponse.json({ error: "Unknown business" }, { status: 404 });

  const conversation = await getConversation(org.id, conversationId);
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const messages = await getMessages(conversationId);
  return NextResponse.json({ messages });
}
