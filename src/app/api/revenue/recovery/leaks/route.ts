import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { canManageAllLeads } from "@/lib/lead-access";
import { getRecoveryAutopilot } from "@/lib/revenue-recovery-autopilot";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

/**
 * GET /api/revenue/recovery/leaks
 *
 * Focused leak list for manager/agent views. Same computation as the
 * autopilot snapshot, projected to leaks only (no duplicate engine).
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
    return NextResponse.json({
      calculatedAt: result.calculatedAt,
      scopedToAgentId: result.scopedToAgentId,
      overview: result.overview,
      leaks: result.leaks,
    });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
