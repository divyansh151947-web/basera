import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { conversations, messages } from "@/db/schema";
import { getLeadById, listLeadInterests, recordScoreEvent, saveMatchedInterests, updateLead } from "@/lib/data/leads";
import { getScoringConfig } from "@/lib/data/org";
import { matchProperties } from "./property-matching";
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  buildScoringInputs,
  scoreLead,
  type ScoreResult,
} from "./lead-scoring";

/**
 * LEAD RE-SCORING (the one place a lead's score is recalculated outside the
 * conversation turn).
 *
 * The score is derived from PERSISTED lead state — requirement fields,
 * saved property interests, the full message history and the org's scoring
 * config — so a manual lead, an imported lead and an AI-qualified lead all
 * go through the identical arithmetic. Used by:
 *   - POST   /api/leads            (a new manual lead is scored at creation)
 *   - PATCH  /api/leads/:id        (requirement / status edits re-score)
 *   - POST   /api/leads/:id/rescore (explicit "recalculate" button)
 */

export interface RescoreOutcome {
  scoreResult: ScoreResult;
  reason: string;
}

function parseWeights(raw: string | null | undefined): typeof DEFAULT_WEIGHTS {
  if (!raw) return DEFAULT_WEIGHTS;
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? { ...DEFAULT_WEIGHTS, ...parsed } : DEFAULT_WEIGHTS;
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

export async function rescoreLead(organizationId: string, leadId: string, opts: { reason?: string } = {}): Promise<RescoreOutcome | null> {
  const lead = await getLeadById(organizationId, leadId);
  if (!lead) return null;

  const [scoringConfig, leadConversations, interests] = await Promise.all([
    getScoringConfig(organizationId),
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.organizationId, organizationId), eq(conversations.leadId, leadId))),
    listLeadInterests(organizationId, leadId),
  ]);

  const conversationIds = leadConversations.map((c) => c.id);
  const messageRows =
    conversationIds.length > 0
      ? await db
          .select({ sender: messages.sender, createdAt: messages.createdAt })
          .from(messages)
          .where(inArray(messages.conversationId, conversationIds))
          .orderBy(asc(messages.createdAt))
      : [];

  // Property match: prefer the interests already on file; otherwise compute a
  // live match from the lead's requirement and persist it so the score (and
  // the next-best-action engine) stay consistent between screens.
  let hasPropertyMatch = interests.some((i) => i.matchType === "EXACT" || i.matchType === "CLOSE");
  if (!hasPropertyMatch && (lead.preferredCity || lead.bhk || lead.propertyType)) {
    try {
      const matches = await matchProperties(
        organizationId,
        {
          city: lead.preferredCity ?? undefined,
          locality: lead.preferredLocality ?? undefined,
          bhk: lead.bhk ?? undefined,
          propertyType: lead.propertyType ?? undefined,
          budgetMinInr: lead.budgetMinInr ?? undefined,
          budgetMaxInr: lead.budgetMaxInr ?? undefined,
        },
        5
      );
      hasPropertyMatch = matches.some((m) => m.matchType !== "ALTERNATIVE");
      if (matches.length > 0) {
        await saveMatchedInterests(
          organizationId,
          leadId,
          matches.map((m) => ({ propertyId: m.property.id, matchType: m.matchType, matchScore: m.matchScore }))
        );
      }
    } catch (error) {
      console.error("[rescore] property matching failed", { organizationId, leadId, error });
    }
  }

  const inputs = buildScoringInputs({
    budgetMinInr: lead.budgetMinInr,
    budgetMaxInr: lead.budgetMaxInr,
    preferredCity: lead.preferredCity,
    bhk: lead.bhk,
    propertyType: lead.propertyType,
    timeline: lead.timeline,
    siteVisitInterest: lead.siteVisitInterest,
    loanRequired: lead.loanRequired,
    leadMessageCount: messageRows.filter((m) => m.sender === "LEAD").length,
    hasPropertyMatch,
    messages: messageRows.map((m) => ({ sender: m.sender, createdAt: m.createdAt })),
  });

  const scoreResult = scoreLead(
    inputs,
    parseWeights(scoringConfig?.weightsJson),
    scoringConfig
      ? { hot: scoringConfig.hotThreshold, warm: scoringConfig.warmThreshold }
      : DEFAULT_THRESHOLDS
  );

  await updateLead(organizationId, leadId, {
    score: scoreResult.score,
    temperature: scoreResult.temperature,
  } as any);

  const breakdown = scoreResult.breakdown.map((b) => `${b.factor}: ${b.points}/${b.max}`).join("; ");
  const reason = `${opts.reason ?? "Recalculated"} — ${breakdown}`;
  await recordScoreEvent(leadId, scoreResult.score, scoreResult.temperature, reason);

  return { scoreResult, reason };
}
