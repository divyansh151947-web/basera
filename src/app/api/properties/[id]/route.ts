import { NextRequest, NextResponse } from "next/server";
import { requireRole, TenantAuthError } from "@/lib/tenant";
import { getPropertyById, updateProperty, archiveProperty } from "@/lib/data/properties";
import { propertySchema } from "@/lib/validation";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId } = await requireRole(["BUSINESS_ADMIN", "MANAGER", "SALES_AGENT"]);
    const property = await getPropertyById(organizationId, params.id);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ property });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
    const body = await req.json();
    const parsed = propertySchema.partial().safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    const property = await updateProperty(organizationId, params.id, parsed.data as any);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ property });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
    const property = await archiveProperty(organizationId, params.id);
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
