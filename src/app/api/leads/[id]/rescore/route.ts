import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getLeadById } from "@/lib/data/leads";
import { requireLeadAccess } from "@/lib/lead-access";
import { rescoreLead } from "@/lib/ai/rescore";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const lead = await getLeadById(organizationId, params.id);
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireLeadAccess(role, userId, lead);

    const outcome = await rescoreLead(organizationId, params.id, { reason: "Manual recalculation" });
    if (!outcome) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ score: outcome.scoreResult.score, temperature: outcome.scoreResult.temperature, breakdown: outcome.scoreResult.breakdown, reason: outcome.reason });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}