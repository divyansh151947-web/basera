import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { listConversations } from "@/lib/data/conversations";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import { parsePaginationParams } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const { limit, offset } = parsePaginationParams(req.nextUrl.searchParams);
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const rows = await listConversations(organizationId, { status }, { limit, offset });
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return NextResponse.json({ conversations: items, limit, offset, hasMore });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
