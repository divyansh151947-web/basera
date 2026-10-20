import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant, requireRole, TenantAuthError } from "@/lib/tenant";
import { getOrganization, updateOrganization } from "@/lib/data/org";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
});

export async function GET() {
  try {
    const { organizationId } = await requireTenant();
    const org = await getOrganization(organizationId);
    if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    return NextResponse.json({ organization: org });
  } catch (error) {
    if (error instanceof TenantAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { organizationId } = await requireRole(["BUSINESS_ADMIN"]);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const org = await updateOrganization(organizationId, {
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
    } as any);
    return NextResponse.json({ organization: org });
  } catch (error) {
    if (error instanceof TenantAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
