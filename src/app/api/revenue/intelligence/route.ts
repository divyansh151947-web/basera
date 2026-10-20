import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { canManageAllLeads } from "@/lib/lead-access";
import { getRevenueIntelligence } from "@/lib/revenue-intelligence";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    // Managers see the whole pipeline; agents see only their own plus
    // unassigned leads, enforced inside the aggregation — never in the UI.
    const result = await getRevenueIntelligence(
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
