import { NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getDashboardCounts, leadsOverTime, leadsBySource, agentPerformance } from "@/lib/data/leads";

export async function GET() {
  try {
    const { organizationId } = await requireTenant();
    const [counts, overTime, bySource, byAgent] = await Promise.all([
      getDashboardCounts(organizationId),
      leadsOverTime(organizationId),
      leadsBySource(organizationId),
      agentPerformance(organizationId),
    ]);

    const funnelOrder = ["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED"];
    const funnel = funnelOrder.map((stage) => ({ stage, count: counts.byStatus[stage] ?? 0 }));

    return NextResponse.json({ counts, overTime, bySource, byAgent, funnel });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
