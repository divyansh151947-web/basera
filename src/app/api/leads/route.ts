import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { listLeads, createLead } from "@/lib/data/leads";
import { leadCreateSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireTenant();
    const sp = req.nextUrl.searchParams;
    const rows = await listLeads(organizationId, {
      status: sp.get("status") ?? undefined,
      temperature: sp.get("temperature") ?? undefined,
      assignedAgentId: sp.get("assignedAgentId") ?? undefined,
      source: sp.get("source") ?? undefined,
      search: sp.get("search") ?? undefined,
    });
    return NextResponse.json({ leads: rows });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { organizationId } = await requireTenant();
    const body = await req.json();
    const parsed = leadCreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    const lead = await createLead(organizationId, parsed.data as any);
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
