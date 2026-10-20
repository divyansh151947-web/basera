import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { requireLeadAccess } from "@/lib/lead-access";
import { getLeadById } from "@/lib/data/leads";
import { getRecoveryTimeline } from "@/lib/revenue-recovery-autopilot";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

/**
 * GET /api/revenue/recovery/timeline/[leadId]
 *
 * Factual per-lead recovery timeline built from existing rows only.
 * Tenant scope first (404), then assignment scope (403) — no IDs trusted
 * from the client beyond the path parameter.
 */
export async function GET(req: NextRequest, { params }: { params: { leadId: string } }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const lead = await getLeadById(organizationId, params.leadId);
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireLeadAccess(role, userId, lead);
    const timeline = await getRecoveryTimeline(organizationId, lead.id);
    if (!timeline) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(timeline);
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
