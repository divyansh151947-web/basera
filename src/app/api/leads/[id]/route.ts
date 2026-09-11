import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getLeadById, updateLead } from "@/lib/data/leads";
import { leadUpdateSchema } from "@/lib/validation";
import { stopFollowUps } from "@/lib/ai/followup-agent";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId } = await requireTenant();
    const lead = await getLeadById(organizationId, params.id);
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ lead });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId } = await requireTenant();
    const body = await req.json();
    const parsed = leadUpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

    const lead = await updateLead(organizationId, params.id, parsed.data as any);
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (parsed.data.status === "CONVERTED" || parsed.data.status === "LOST" || parsed.data.optedOut) {
      await stopFollowUps(organizationId, params.id, parsed.data.optedOut ? "Lead opted out" : `Status changed to ${parsed.data.status}`);
    }

    return NextResponse.json({ lead });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
