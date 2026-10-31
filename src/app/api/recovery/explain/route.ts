import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getLeadById } from "@/lib/data/leads";
import { isLeadAuthorized } from "@/lib/lead-access";
import { staffApiLimiter, rateLimitedResponse, getClientIp } from "@/lib/rate-limit";
import { callAI, aiIsConfigured } from "@/lib/ai/ai-provider";
import { evaluateSingleLeadRecovery } from "@/lib/recovery-engine";
import {
  fallbackExplanation,
  buildRecoveryExplanationPrompt,
  RECOVERY_EXPLANATION_SYSTEM,
  type RecoveryExplanationFacts,
} from "@/lib/ai/recovery-explanation";

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const sp = req.nextUrl.searchParams;
    const leadId = sp.get("leadId");
    if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

    const lead = await getLeadById(organizationId, leadId);
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    if (!isLeadAuthorized(role, userId, lead)) {
      return NextResponse.json({ error: "Not authorized to access this lead" }, { status: 403 });
    }

    const single = await evaluateSingleLeadRecovery(organizationId, leadId);
    const risk = single?.risk;
    const decision = single?.decision;

    const facts = {
      leadName: lead.name,
      riskLevel: risk?.riskLevel ?? "LOW",
      riskScore: risk?.riskScore ?? 0,
      leadScore: risk?.leadScore ?? lead.score ?? 0,
      lastInboundHoursAgo: risk?.lastInteractionAt
        ? (Date.now() - new Date(risk.lastInteractionAt).getTime()) / 3_600_000
        : null,
      recommendedAction: decision?.actionType ?? null,
      reasons: risk?.reasons ?? [],
    };

    let explanation: string;
    let aiUsed = false;

    if (aiIsConfigured()) {
      try {
        const { text } = await callAI({
          system: RECOVERY_EXPLANATION_SYSTEM,
          messages: [
            {
              role: "user",
              content: buildRecoveryExplanationPrompt(facts) + `\nWrite a short, honest recovery recommendation an agent can act on.`,
            },
          ],
          maxTokens: 220,
        });
        const cleaned = (text ?? "").trim();
        if (cleaned.length > 0) {
          explanation = cleaned;
          aiUsed = true;
        } else {
          explanation = fallbackExplanation(facts);
        }
      } catch {
        explanation = fallbackExplanation(facts);
      }
    } else {
      explanation = fallbackExplanation(facts);
    }

    return NextResponse.json({
      leadId,
      explanation,
      aiUsed,
      fallback: !aiUsed,
      facts: {
        riskLevel: facts.riskLevel,
        riskScore: facts.riskScore,
        leadScore: facts.leadScore,
        recommendedAction: facts.recommendedAction,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
