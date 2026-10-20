import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { listNotifications } from "@/lib/data/org";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const rows = await listNotifications(organizationId, userId);
    return NextResponse.json({ notifications: rows });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
