import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { requireLeadAccess } from "@/lib/lead-access";
import { evaluateSingleLeadRecovery, executeRecoveryAction } from "@/lib/recovery-engine";
import { getLeadById } from "@/lib/data/leads";
import { getLatestConversationForLead } from "@/lib/data/conversations";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

const bodySchema = z.object({ leadId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    // Tenant scope first (unknown/foreign ids → 404), then assignment scope
    // (colleague's lead → 403). No IDs are ever trusted from the client.
    const lead = await getLeadById(organizationId, parsed.data.leadId);
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireLeadAccess(role, userId, lead);

    const evaluated = await evaluateSingleLeadRecovery(organizationId, lead.id);
    if (!evaluated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!evaluated.decision.shouldRecover) {
      return NextResponse.json({
        recovered: false,
        leadId: lead.id,
        reason: evaluated.decision.noActionReason ?? "No recovery warranted.",
      });
    }

    const result = await executeRecoveryAction(organizationId, lead.id, evaluated.decision, {
      assignedAgentId: lead.assignedAgentId,
      conversationId: (await getLatestConversationForLead(organizationId, lead.id))?.id ?? null,
      actorUserId: userId,
    });
    return NextResponse.json({ recovered: result.attempted, leadId: lead.id, action: result });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
