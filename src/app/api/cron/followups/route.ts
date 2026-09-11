import { NextRequest, NextResponse } from "next/server";
import { getDueFollowUpsAcrossTenants, draftFollowUpMessage, scheduleNextFollowUp } from "@/lib/ai/followup-agent";
import { db } from "@/db/client";
import { followUps, leads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateConversationForLead, addMessage } from "@/lib/data/conversations";

/**
 * Intended to be invoked by an external scheduler (cron, Vercel Cron, etc.)
 * on a short interval (e.g. every 15 min), NOT by end users. Protected by a
 * shared secret so it can't be triggered by arbitrary requests.
 *
 * NOTE: actually delivering the follow-up over WhatsApp/email/SMS requires
 * the corresponding integration's API credentials (see Integration model);
 * in this build the message is generated and stored in the conversation
 * timeline, which is real, but outbound delivery via a channel provider is
 * a stubbed call site clearly marked below — wire up your provider there.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await getDueFollowUpsAcrossTenants();
  const results: { leadId: string; status: string }[] = [];

  for (const fu of due) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, fu.leadId)).limit(1);
    if (!lead || lead.optedOut || ["CONVERTED", "LOST"].includes(lead.status)) {
      await db.update(followUps).set({ status: "STOPPED", stopReason: "Lead no longer eligible" }).where(eq(followUps.id, fu.id));
      results.push({ leadId: fu.leadId, status: "stopped" });
      continue;
    }

    const draft = await draftFollowUpMessage(fu.organizationId, fu.leadId);
    const conversation = await getOrCreateConversationForLead(fu.organizationId, fu.leadId, fu.channel);
    await addMessage(conversation.id, "AI", draft, { metadata: { followUpAttempt: fu.attemptNumber } });

    // --- OUTBOUND DELIVERY STUB ---
    // Wire an actual WhatsApp Business API / email provider call here using
    // the org's Integration config. Not implemented in this build since it
    // requires live business credentials (see README "Features requiring
    // external API credentials").

    await db.update(followUps).set({ status: "SENT", sentAt: new Date().toISOString(), messageDraft: draft }).where(eq(followUps.id, fu.id));
    await scheduleNextFollowUp(fu.organizationId, fu.leadId, fu.attemptNumber);
    results.push({ leadId: fu.leadId, status: "sent" });
  }

  return NextResponse.json({ processed: results.length, results });
}
