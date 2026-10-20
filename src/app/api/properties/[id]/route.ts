import { NextRequest, NextResponse } from "next/server";
import { requireRole, TenantAuthError } from "@/lib/tenant";
import { getPropertyById, updateProperty, archiveProperty } from "@/lib/data/properties";
import { propertyUpdateSchema } from "@/lib/validation";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, userId } = await requireRole(["BUSINESS_ADMIN", "MANAGER", "SALES_AGENT"]);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const property = await getPropertyById(organizationId, params.id);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ property });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, userId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const body = await req.json();
    const parsed = propertyUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    const property = await updateProperty(organizationId, params.id, parsed.data as any);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ property });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, userId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const property = await archiveProperty(organizationId, params.id);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ property });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
