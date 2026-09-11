import { NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { listNotifications } from "@/lib/data/org";

export async function GET() {
  try {
    const { organizationId, userId } = await requireTenant();
    const rows = await listNotifications(organizationId, userId);
    return NextResponse.json({ notifications: rows });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
