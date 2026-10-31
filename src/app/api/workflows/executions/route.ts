import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { listWorkflowExecutions } from "@/lib/data/workflows";
import { staffApiLimiter, rateLimitedResponse, getClientIp } from "@/lib/rate-limit";

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const sp = req.nextUrl.searchParams;
    const limit = sp.get("limit") ? Number.parseInt(sp.get("limit")!) : 50;
    const rows = await listWorkflowExecutions(organizationId, limit);
    return NextResponse.json({ executions: rows });
  } catch (err) {
    return handleError(err);
  }
}
