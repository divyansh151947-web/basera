import { NextRequest, NextResponse } from "next/server";
import { requireRole, TenantAuthError } from "@/lib/tenant";
import { listProperties, createProperty } from "@/lib/data/properties";
import { propertySchema } from "@/lib/validation";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import { parsePaginationParams } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireRole(["BUSINESS_ADMIN", "MANAGER", "SALES_AGENT"]);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const sp = req.nextUrl.searchParams;
    const { limit, offset } = parsePaginationParams(sp);
    const rows = await listProperties(organizationId, {
      city: sp.get("city") ?? undefined,
      bhk: sp.get("bhk") ? Number(sp.get("bhk")) : undefined,
      propertyType: sp.get("propertyType") ?? undefined,
      availability: sp.get("availability") ?? undefined,
      developer: sp.get("developer") ?? undefined,
      search: sp.get("search") ?? undefined,
    }, { limit, offset });
    // Paged read returns at most limit+1 rows (same order); slice to the
    // page and derive hasMore without a full-table scan.
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return NextResponse.json({ properties: items, limit, offset, hasMore });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const body = await req.json();
    const parsed = propertySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    const property = await createProperty(organizationId, parsed.data as any);
    return NextResponse.json({ property }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
