import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { requireLeadAccess } from "@/lib/lead-access";
import { evaluateSingleLeadRecovery, executeRecoveryAction } from "@/lib/recovery-engine";
import { getLeadById } from "@/lib/data/leads";
import { getLatestConversationForLead } from "@/lib/data/conversations";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import {
  AUTOPILOT_EXECUTE_ACTION,
  EXECUTE_IDEMPOTENCY_HOURS,
  findRecentAutopilotAudits,
  recordAutopilotAudit,
  resolveAutopilotLeadId,
  type RevenueLeakType,
} from "@/lib/revenue-recovery-autopilot";

const bodySchema = z.object({
  leakType: z.string().min(1).max(64).optional(),
});

/**
 * POST /api/revenue/recovery/actions/[id]/execute
 *
 * Executes the current recovery decision for a lead through the EXISTING
 * recovery paths only (follow-up pipeline / task / alert / handoff). AUTO
 * work still flows through scheduleNextFollowUp with its opt-out, closed,
 * and max-attempt guards — no new customer-facing send is introduced.
 *
 * Idempotent: a recent execute audit for the same lead inside the
 * idempotency window returns 409 instead of creating duplicate work (on top
 * of the engine's own pending-task/cooldown suppression).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const leadId = resolveAutopilotLeadId(params.id);
    const lead = await getLeadById(organizationId, leadId);
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireLeadAccess(role, userId, lead);

    // Duplicate-execution guard: an execute audit inside the window means
    // this lead was already acted on — do not create a second task/send.
    const recent = await findRecentAutopilotAudits(
      organizationId,
      AUTOPILOT_EXECUTE_ACTION,
      new Date(Date.now() - EXECUTE_IDEMPOTENCY_HOURS * 3_600_000).toISOString(),
      50
    );
    if (recent.some((a) => a.entityId === lead.id)) {
      return NextResponse.json(
        { error: "A recovery action was already executed for this lead recently — duplicate execution prevented." },
        { status: 409 }
      );
    }

    const evaluated = await evaluateSingleLeadRecovery(organizationId, lead.id);
    if (!evaluated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!evaluated.decision.shouldRecover) {
      return NextResponse.json({
        executed: false,
        leadId: lead.id,
        reason: evaluated.decision.noActionReason ?? "No recovery warranted.",
      });
    }

    const result = await executeRecoveryAction(organizationId, lead.id, evaluated.decision, {
      assignedAgentId: lead.assignedAgentId,
      conversationId: (await getLatestConversationForLead(organizationId, lead.id))?.id ?? null,
      actorUserId: userId,
    });

    await recordAutopilotAudit(organizationId, userId, AUTOPILOT_EXECUTE_ACTION, lead.id, {
      leakType: (parsed.data.leakType ?? null) as RevenueLeakType | null,
      actionType: result.actionType,
      automation: result.automation,
      recordKind: result.recordKind,
      summary: `Executed ${result.actionType ?? "recovery"} via ${result.automation ?? "unknown"} path (${result.recordKind ?? "no record"}). Attempt — not revenue.`,
    });

    return NextResponse.json({ executed: result.attempted, leadId: lead.id, action: result });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
