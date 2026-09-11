import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { listAppointments, createAppointment, updateAppointment } from "@/lib/data/org";
import { appointmentSchema } from "@/lib/validation";
import { updateLead } from "@/lib/data/leads";

export async function GET() {
  try {
    const { organizationId } = await requireTenant();
    const rows = await listAppointments(organizationId);
    return NextResponse.json({ appointments: rows });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { organizationId } = await requireTenant();
    const body = await req.json();
    const parsed = appointmentSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });

    const appointment = await createAppointment(organizationId, parsed.data as any);
    if (parsed.data.type === "SITE_VISIT") {
      await updateLead(organizationId, parsed.data.leadId, { status: "SITE_VISIT_SCHEDULED" } as any);
    }
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
