import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { listLeads, createLead } from "@/lib/data/leads";
import { canManageAllLeads } from "@/lib/lead-access";
import { leadCreateSchema } from "@/lib/validation";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import { parsePaginationParams, paginateList } from "@/lib/pagination";
import { rescoreLead } from "@/lib/ai/rescore";

export async function GET(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const sp = req.nextUrl.searchParams;
    const { limit, offset } = parsePaginationParams(sp);
    const filters = {
      status: sp.get("status") ?? undefined,
      temperature: sp.get("temperature") ?? undefined,
      assignedAgentId: sp.get("assignedAgentId") ?? undefined,
      source: sp.get("source") ?? undefined,
      search: sp.get("search") ?? undefined,
    };
    // Managers have organization-wide visibility with no post-filter, so the
    // page can come straight from SQL (limit+1 trick). Agents keep the
    // legacy full-read + assignment-filter path so their pages are unchanged.
    if (canManageAllLeads(role)) {
      const rows = await listLeads(organizationId, filters, { limit, offset });
      const items = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      return NextResponse.json({ leads: items, limit, offset, hasMore });
    }
    const rows = await listLeads(organizationId, filters);
    // Agents see only leads assigned to them plus unassigned ones, so the
    // list is consistent with the per-lead rule enforced on detail/PATCH.
    const visible = rows.filter((l) => !l.assignedAgentId || l.assignedAgentId === userId);
    const { items, hasMore } = paginateList(visible, { limit, offset });
    return NextResponse.json({ leads: items, limit, offset, hasMore });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const body = await req.json();
    const parsed = leadCreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    const lead = await createLead(organizationId, parsed.data as any);
    await rescoreLead(organizationId, lead.id, { reason: "Created" });
    return NextResponse.json({ lead }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
