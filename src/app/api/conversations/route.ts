import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { listConversations } from "@/lib/data/conversations";

export async function GET(req: NextRequest) {
  try {
    const { organizationId } = await requireTenant();
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const rows = await listConversations(organizationId, { status });
    return NextResponse.json({ conversations: rows });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
