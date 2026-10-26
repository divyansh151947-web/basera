import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  claimFollowUpForProcessing,
  cleanupFollowUpClaims,
  draftFollowUpMessage,
  getDueFollowUpsAcrossTenants,
  releaseFollowUpClaim,
  scheduleNextFollowUp,
} from "@/lib/ai/followup-agent";
import { db } from "@/db/client";
import { followUps, leads, organizations } from "@/db/schema";
import { getOrCreateConversationForLead, addMessage } from "@/lib/data/conversations";
import { isValidEmailAddress, sendLeadFollowUpEmail } from "@/lib/email";

/**
 * POST /api/cron/followups — scheduled AI lead follow-ups.
 *
 * Intended to be invoked by an external scheduler (cron, Vercel Cron, etc.)
 * on a short interval (e.g. every 15 min), NOT by end users. Protected by a
 * shared secret so it can't be triggered by arbitrary requests.
 *
 * HONEST DELIVERY SEMANTICS (per-channel, no pretended sends):
 *  - EMAIL      → a real email is sent through the single delivery path
 *                 (deliverEmail: SMTP-first, Resend fallback). The row is
 *                 marked SENT only when the provider ACCEPTS the message;
 *                 any failure marks it FAILED (visible + diagnosable in the
 *                 CRM) and does NOT advance the follow-up schedule.
 *  - WEBSITE_CHAT → the draft is posted to the lead-facing conversation
 *                 timeline, which IS the delivery surface for that channel.
 *  - WHATSAPP / INSTAGRAM / FACEBOOK → no outbound provider integration
 *                 exists in this build, so the draft is recorded for the
 *                 team and the row is marked SKIPPED — never falsely "SENT".
 *
 * DUPLICATE PREVENTION: every row is claimed through the atomic
 * recovery_claims PK (INSERT ... ON CONFLICT DO NOTHING + lease) before any
 * processing, and every terminal write is a conditional PENDING→x update,
 * so two overlapping cron runs can never send the same follow-up twice.
 */
const MAX_FOLLOWUPS_PER_RUN = 100;

interface CronItemResult {
  leadId: string;
  followUpId: string;
  status: string;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!isCronAuthorized(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = `followups-cron:${new Date().toISOString()}:${Math.random().toString(36).slice(2, 10)}`;
  await cleanupFollowUpClaims();

  const due = (await getDueFollowUpsAcrossTenants()).slice(0, MAX_FOLLOWUPS_PER_RUN);
  const results: CronItemResult[] = [];

  for (const fu of due) {
    try {
      // Atomic claim: exactly one concurrent run may process this row.
      const claim = await claimFollowUpForProcessing(fu.id, fu.organizationId, fu.leadId, runId);
      if (!claim.claimed) {
        results.push({ leadId: fu.leadId, followUpId: fu.id, status: "skipped", reason: claim.reason ?? "claim-lost" });
        continue;
      }

      // Re-read AFTER the claim: a previous run may have crashed between
      // its terminal row write and its claim release, leaving an EXPIRED
      // lease over an already-processed row. Only PENDING rows proceed, so
      // a reclaim can never re-send. (The remaining crash window — provider
      // accepted the message but the row write was lost — is inherent
      // at-least-once behavior, bounded by the lease, exactly like the
      // recovery scheduler.)
      const freshRows = await db.select().from(followUps).where(eq(followUps.id, fu.id)).limit(1);
      const fresh = freshRows[0];
      if (!fresh || fresh.status !== "PENDING") {
        await releaseFollowUpClaim(fu.id, runId, "SKIPPED", "row-no-longer-pending");
        results.push({ leadId: fu.leadId, followUpId: fu.id, status: "skipped", reason: "already-processed" });
        continue;
      }

      // Tenant-bound lead read (organizationId enforced, not just leadId).
      const leadRows = await db
        .select()
        .from(leads)
        .where(and(eq(leads.id, fu.leadId), eq(leads.organizationId, fu.organizationId)))
        .limit(1);
      const lead = leadRows[0];

      if (!lead || lead.optedOut || ["CONVERTED", "LOST"].includes(lead.status)) {
        await db
          .update(followUps)
          .set({ status: "STOPPED", stopReason: "Lead no longer eligible" })
          .where(and(eq(followUps.id, fu.id), eq(followUps.status, "PENDING")));
        await releaseFollowUpClaim(fu.id, runId, "SKIPPED", "Lead no longer eligible");
        results.push({ leadId: fu.leadId, followUpId: fu.id, status: "stopped" });
        continue;
      }

      const draft = await draftFollowUpMessage(fu.organizationId, fu.leadId);

      if (fu.channel === "EMAIL") {
        const recipient = typeof lead.email === "string" ? lead.email.trim() : "";
        if (!isValidEmailAddress(recipient)) {
          // No valid recipient: sending is impossible. Record honestly and
          // stop this follow-up (the next attempt would fail the same way).
          await db
            .update(followUps)
            .set({ status: "SKIPPED", stopReason: "Lead has no valid email address", messageDraft: draft })
            .where(and(eq(followUps.id, fu.id), eq(followUps.status, "PENDING")));
          await releaseFollowUpClaim(fu.id, runId, "SKIPPED", "no-valid-recipient");
          results.push({ leadId: fu.leadId, followUpId: fu.id, status: "skipped", reason: "no_valid_recipient" });
          continue;
        }

        const orgRows = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, fu.organizationId))
          .limit(1);

        const send = await sendLeadFollowUpEmail({
          to: recipient,
          leadName: lead.name,
          organizationName: orgRows[0]?.name ?? null,
          message: draft,
        });

        if (!send.ok) {
          // Provider failure: FAILED stays visible in the CRM and the
          // schedule does NOT advance as if the message had gone out.
          await db
            .update(followUps)
            .set({ status: "FAILED", stopReason: `Email delivery failed (${send.reason})`, messageDraft: draft })
            .where(and(eq(followUps.id, fu.id), eq(followUps.status, "PENDING")));
          await releaseFollowUpClaim(fu.id, runId, "FAILED", `email-${send.reason}`);
          results.push({ leadId: fu.leadId, followUpId: fu.id, status: "failed", reason: send.reason });
          continue;
        }

        // Provider accepted (≠ confirmed inbox delivery): record on the
        // timeline, mark SENT, and advance the bounded nurture cadence.
        const conversation = await getOrCreateConversationForLead(fu.organizationId, fu.leadId, "EMAIL");
        await addMessage(conversation.id, "AI", draft, {
          metadata: {
            followUpAttempt: fu.attemptNumber,
            channel: "EMAIL",
            delivery: "provider_accepted",
            provider: send.provider,
            emailId: send.id ?? null,
          },
        });
        await db
          .update(followUps)
          .set({ status: "SENT", sentAt: new Date().toISOString(), messageDraft: draft })
          .where(and(eq(followUps.id, fu.id), eq(followUps.status, "PENDING")));
        await scheduleNextFollowUp(fu.organizationId, fu.leadId, fu.attemptNumber);
        await releaseFollowUpClaim(fu.id, runId, "COMPLETED", "email-accepted");
        results.push({ leadId: fu.leadId, followUpId: fu.id, status: "sent" });
        continue;
      }

      if (fu.channel === "WEBSITE_CHAT") {
        // The conversation timeline IS the surface the lead reads, so
        // posting the draft is real delivery for this channel.
        const conversation = await getOrCreateConversationForLead(fu.organizationId, fu.leadId, "WEBSITE_CHAT");
        await addMessage(conversation.id, "AI", draft, {
          metadata: { followUpAttempt: fu.attemptNumber, channel: "WEBSITE_CHAT" },
        });
        await db
          .update(followUps)
          .set({ status: "SENT", sentAt: new Date().toISOString(), messageDraft: draft })
          .where(and(eq(followUps.id, fu.id), eq(followUps.status, "PENDING")));
        await scheduleNextFollowUp(fu.organizationId, fu.leadId, fu.attemptNumber);
        await releaseFollowUpClaim(fu.id, runId, "COMPLETED", "timeline-posted");
        results.push({ leadId: fu.leadId, followUpId: fu.id, status: "sent" });
        continue;
      }

      // WHATSAPP / INSTAGRAM / FACEBOOK: no outbound provider integration in
      // this build. Record the draft for the team, mark SKIPPED (never
      // falsely SENT), and keep the (bounded) nurture cadence moving.
      const conversation = await getOrCreateConversationForLead(fu.organizationId, fu.leadId, fu.channel);
      await addMessage(conversation.id, "AI", draft, {
        metadata: { followUpAttempt: fu.attemptNumber, channel: fu.channel, delivery: "not_configured" },
      });
      await db
        .update(followUps)
        .set({ status: "SKIPPED", stopReason: `Outbound delivery is not configured for channel ${fu.channel}`, messageDraft: draft })
        .where(and(eq(followUps.id, fu.id), eq(followUps.status, "PENDING")));
      await scheduleNextFollowUp(fu.organizationId, fu.leadId, fu.attemptNumber);
      await releaseFollowUpClaim(fu.id, runId, "SKIPPED", `channel-not-configured:${fu.channel}`);
      results.push({ leadId: fu.leadId, followUpId: fu.id, status: "skipped", reason: "channel_not_configured" });
    } catch (err) {
      // Per-item failure: record it, release the lease safely, continue the
      // batch. No PII, no drafts, no secrets in the summary.
      const message = err instanceof Error ? err.message.replace(/[\r\n]+/g, " ").slice(0, 200) : "unknown";
      await db
        .update(followUps)
        .set({ status: "FAILED", stopReason: `Processing error (${message})` })
        .where(and(eq(followUps.id, fu.id), eq(followUps.status, "PENDING")));
      await releaseFollowUpClaim(fu.id, runId, "FAILED", `processing-error:${message}`);
      results.push({ leadId: fu.leadId, followUpId: fu.id, status: "failed", reason: "processing_error" });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
