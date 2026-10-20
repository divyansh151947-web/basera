import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { canManageAllLeads } from "@/lib/lead-access";
import { getOrganizationRevenueRisk } from "@/lib/revenue-at-risk";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    // Same visibility contract as Batch 1B-4: managers see the whole
    // pipeline; agents see only their own plus unassigned leads.
    const summary = await getOrganizationRevenueRisk(
      organizationId,
      canManageAllLeads(role) ? {} : { assignedAgentId: userId }
    );
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
