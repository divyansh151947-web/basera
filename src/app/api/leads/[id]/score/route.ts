import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getLeadById } from "@/lib/data/leads";
import { getScoringConfig } from "@/lib/data/org";
import { isLeadAuthorized } from "@/lib/lead-access";
import { staffApiLimiter, rateLimitedResponse, getClientIp } from "@/lib/rate-limit";
import {
  scoreLead,
  buildScoringInputs,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
} from "@/lib/ai/lead-scoring";
import { rescoreLead } from "@/lib/ai/rescore";
import { db } from "@/db/client";
import {
  conversations,
  messages,
  leadPropertyInterests,
} from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

async function computeScore(organizationId: string, lead: any) {
  const [scoringConfig, leadConversations, interests] = await Promise.all([
    getScoringConfig(organizationId),
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.organizationId, organizationId), eq(conversations.leadId, lead.id))),
    db
      .select({ matchType: leadPropertyInterests.matchType, matchScore: leadPropertyInterests.matchScore })
      .from(leadPropertyInterests)
      .where(eq(leadPropertyInterests.leadId, lead.id)),
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

  const hasPropertyMatch = interests.some((i) => i.matchType === "EXACT" || i.matchType === "CLOSE");
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

  const weights =
    scoringConfig?.weightsJson
      ? (() => {
          try {
            return { ...DEFAULT_WEIGHTS, ...JSON.parse(scoringConfig.weightsJson) };
          } catch {
            return DEFAULT_WEIGHTS;
          }
        })()
      : DEFAULT_WEIGHTS;
  const thresholds = scoringConfig
    ? { hot: scoringConfig.hotThreshold, warm: scoringConfig.warmThreshold }
    : DEFAULT_THRESHOLDS;

  const result = scoreLead(inputs, weights, thresholds);
  return { result, inputs, messageCount: messageRows.length, interestCount: interests.length };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const { id: leadId } = await params;
    const lead = await getLeadById(organizationId, leadId);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    if (!isLeadAuthorized(role, userId, lead)) {
      return NextResponse.json({ error: "Not authorized to access this lead" }, { status: 403 });
    }

    const { result, inputs, messageCount, interestCount } = await computeScore(organizationId, lead);

    const explanation = result.breakdown.map((b) => `${b.factor}: ${b.points}/${b.max}`).join("; ");
    const missing: string[] = [];
    if (!inputs.hasBudget) missing.push("budget");
    if (!inputs.hasLocation) missing.push("location/city");
    if (!inputs.hasBhkOrType) missing.push("property type or BHK");
    if (inputs.timelineWithinDays == null) missing.push("buying timeline");
    if (!inputs.hasPropertyMatch) missing.push("a matching property");

    return NextResponse.json({
      leadId: lead.id,
      score: result.score,
      temperature: result.temperature,
      breakdown: result.breakdown,
      explanation,
      missingInformation: missing,
      signal: {
        messageCount,
        interestCount,
        hasPropertyMatch: inputs.hasPropertyMatch,
        respondedQuickly: inputs.respondedQuickly,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const { id: leadId } = await params;
    const lead = await getLeadById(organizationId, leadId);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    if (!isLeadAuthorized(role, userId, lead)) {
      return NextResponse.json({ error: "Not authorized to access this lead" }, { status: 403 });
    }

    const outcome = await rescoreLead(organizationId, leadId, { reason: "Manual score recalculation" });
    if (!outcome) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    return NextResponse.json({
      leadId: lead.id,
      score: outcome.scoreResult.score,
      temperature: outcome.scoreResult.temperature,
      breakdown: outcome.scoreResult.breakdown,
      reason: outcome.reason,
    });
  } catch (err) {
    return handleError(err);
  }
}
