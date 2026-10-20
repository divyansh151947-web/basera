import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { requireLeadAccess } from "@/lib/lead-access";
import { getLeadById } from "@/lib/data/leads";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import {
  AUTOPILOT_DISMISS_ACTION,
  DISMISS_SUPPRESSION_DAYS,
  recordAutopilotAudit,
  resolveAutopilotLeadId,
  type RevenueLeakType,
} from "@/lib/revenue-recovery-autopilot";

const dismissSchema = z.object({
  leakType: z.string().min(1).max(64).optional(),
  reason: z.string().min(1).max(500).optional(),
});

/**
 * POST /api/revenue/recovery/actions/[id]/dismiss
 *
 * Records a human dismissal in the audit trail (existing audit_logs table —
 * no migration). Advisory suppression: the sweep de-prioritizes dismissed
 * leads for DISMISS_SUPPRESSION_DAYS. The underlying facts are unchanged,
 * so a dismissed leak can honestly reappear after the window.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const parsed = dismissSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const leadId = resolveAutopilotLeadId(params.id);
    const lead = await getLeadById(organizationId, leadId);
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireLeadAccess(role, userId, lead);

    await recordAutopilotAudit(organizationId, userId, AUTOPILOT_DISMISS_ACTION, lead.id, {
      leakType: (parsed.data.leakType ?? null) as RevenueLeakType | null,
      reason: parsed.data.reason ?? null,
      summary: `Dismissed by team member${parsed.data.reason ? `: ${parsed.data.reason}` : ""} (advisory, ${DISMISS_SUPPRESSION_DAYS}-day suppression).`,
    });

    return NextResponse.json({ dismissed: true, leadId: lead.id });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
