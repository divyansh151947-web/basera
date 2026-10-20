import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimitedResponse, knowledgeApiLimiter } from "@/lib/rate-limit";
import { requireTenant, assertTenantScope, TenantAuthError } from "@/lib/tenant";
import { getKnowledgeStats, hasIndexedKnowledge } from "@/lib/knowledge/retrieval";

/**
 * GET /api/knowledge/stats — Get knowledge base statistics for an organization
 *
 * Staff-only: the organization is taken from the authenticated session and
 * any client-supplied organizationId must match it, so one business can
 * never enumerate another's knowledge base.
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await knowledgeApiLimiter.check(`knowledge:stats:${ip}`);
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");

  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  try {
    const { organizationId: sessionOrg } = await requireTenant();
    assertTenantScope(organizationId, sessionOrg);
    const [stats, hasKnowledge] = await Promise.all([
      getKnowledgeStats(organizationId),
      hasIndexedKnowledge(organizationId),
    ]);

    return NextResponse.json({
      ...stats,
      hasIndexedKnowledge: hasKnowledge,
    });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[knowledge] Stats error:", err);
    return NextResponse.json({ error: "Failed to get stats" }, { status: 500 });
  }
}