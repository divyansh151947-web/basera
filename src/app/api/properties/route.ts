import { NextRequest, NextResponse } from "next/server";
import { requireRole, TenantAuthError } from "@/lib/tenant";
import { listProperties, createProperty } from "@/lib/data/properties";
import { propertySchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireRole(["BUSINESS_ADMIN", "MANAGER", "SALES_AGENT"]);
    const sp = req.nextUrl.searchParams;
    const rows = await listProperties(organizationId, {
      city: sp.get("city") ?? undefined,
      bhk: sp.get("bhk") ? Number(sp.get("bhk")) : undefined,
      propertyType: sp.get("propertyType") ?? undefined,
      availability: sp.get("availability") ?? undefined,
      developer: sp.get("developer") ?? undefined,
      search: sp.get("search") ?? undefined,
    });
    return NextResponse.json({ properties: rows });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { organizationId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
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
