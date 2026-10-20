import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { canManageAllLeads } from "@/lib/lead-access";
import { getRecoveryAutopilot } from "@/lib/revenue-recovery-autopilot";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

/**
 * GET /api/revenue/recovery/autopilot
 *
 * The full Revenue Recovery Autopilot snapshot: overview (opportunity vs
 * at-risk vs activity — never fabricated revenue), ranked leaks with
 * explanations, deterministic outcomes, and lost/won analyses.
 * Same visibility contract as the other revenue routes: managers see the
 * whole pipeline; agents see only their own plus unassigned leads.
 */
export async function GET(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const result = await getRecoveryAutopilot(
      organizationId,
      canManageAllLeads(role) ? {} : { assignedAgentId: userId }
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
