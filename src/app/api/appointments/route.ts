import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { listAppointments, createAppointment, updateAppointment } from "@/lib/data/org";
import { appointmentSchema } from "@/lib/validation";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import { parsePaginationParams } from "@/lib/pagination";
import { getLeadById, updateLead } from "@/lib/data/leads";
import { requireLeadAccess } from "@/lib/lead-access";
import { getPropertyById } from "@/lib/data/properties";
import { listTeam } from "@/lib/data/org";

export async function GET(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const { limit, offset } = parsePaginationParams(req.nextUrl.searchParams);
    const rows = await listAppointments(organizationId, { limit, offset });
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return NextResponse.json({ appointments: items, limit, offset, hasMore });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const body = await req.json();
    const parsed = appointmentSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

    // Tenant-scope every referenced row so an appointment can never link
    // across organizations (lead, property, and agent must all belong here).
    // Independent reads run concurrently; writes stay sequential below.
    const [lead, property, team] = await Promise.all([
      getLeadById(organizationId, parsed.data.leadId),
      parsed.data.propertyId ? getPropertyById(organizationId, parsed.data.propertyId) : Promise.resolve(null),
      parsed.data.agentId ? listTeam(organizationId) : Promise.resolve(null),
    ]);
    if (!lead) return NextResponse.json({ error: "Lead not found in this organization" }, { status: 404 });
    // Agents may book only for leads they are authorized to manage.
    requireLeadAccess(role, userId, lead);

    if (parsed.data.propertyId && !property) {
      return NextResponse.json({ error: "Property not found in this organization" }, { status: 404 });
    }

    if (parsed.data.agentId) {
      if (!(team ?? []).some((m) => m.id === parsed.data.agentId)) {
        return NextResponse.json({ error: "Agent not found in this organization" }, { status: 404 });
      }
    }

    const appointment = await createAppointment(organizationId, parsed.data as any);
    if (parsed.data.type === "SITE_VISIT") {
      await updateLead(organizationId, parsed.data.leadId, { status: "SITE_VISIT_SCHEDULED" } as any);
    }
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
