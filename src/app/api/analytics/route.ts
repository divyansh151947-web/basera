import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError, assertTenantScope } from "@/lib/tenant";
import { getDashboardCounts, leadsOverTime, leadsBySource, agentPerformance } from "@/lib/data/leads";
import { getTenantAnalyticsSnapshot } from "@/lib/data/analytics";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const requestedOrgId = req.nextUrl.searchParams.get("organizationId");
    assertTenantScope(requestedOrgId, organizationId);

    const snapshot = await getTenantAnalyticsSnapshot(organizationId);

    const [counts, overTime, bySource, byAgent] = await Promise.all([
      getDashboardCounts(organizationId),
      leadsOverTime(organizationId),
      leadsBySource(organizationId),
      agentPerformance(organizationId),
    ]);

    const funnelOrder = ["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED"];
    const funnel = funnelOrder.map((stage) => ({ stage, count: counts.byStatus[stage] ?? 0 }));

    return NextResponse.json({ snapshot, counts, overTime, bySource, byAgent, funnel });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
