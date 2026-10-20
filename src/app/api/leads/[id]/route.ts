import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getLeadById, updateLead } from "@/lib/data/leads";
import { requireAssignmentPermission, requireLeadAccess } from "@/lib/lead-access";
import { leadUpdateSchema } from "@/lib/validation";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import { stopFollowUps } from "@/lib/ai/followup-agent";
import { rescoreLead } from "@/lib/ai/rescore";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const lead = await getLeadById(organizationId, params.id);
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireLeadAccess(role, userId, lead);
    return NextResponse.json({ lead });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const body = await req.json();
    const parsed = leadUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

    // Load first so both existence (404) and assignment scope (403) are
    // decided server-side before any write.
    const existing = await getLeadById(organizationId, params.id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireLeadAccess(role, userId, existing);

    // Assignment changes are manager-only with same-org target verification.
    if ("assignedAgentId" in parsed.data) {
      await requireAssignmentPermission(role, organizationId, parsed.data.assignedAgentId ?? null);
    }

    const lead = await updateLead(organizationId, params.id, parsed.data as any);
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (parsed.data.status === "CONVERTED" || parsed.data.status === "LOST" || parsed.data.optedOut) {
      await stopFollowUps(organizationId, params.id, parsed.data.optedOut ? "Lead opted out" : `Status changed to ${parsed.data.status}`);
    }

    // Re-score when requirement fields change (but not on assignment/status only changes).
    const requirementFields = ["preferredCity", "preferredLocality", "propertyType", "bhk", "budgetMinInr", "budgetMaxInr", "purpose", "timeline", "loanRequired", "siteVisitInterest"];
    const hasRequirementChange = requirementFields.some((f) => f in parsed.data);
    if (hasRequirementChange) {
      await rescoreLead(organizationId, params.id, { reason: "Requirement updated" });
    }

    return NextResponse.json({ lead });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
