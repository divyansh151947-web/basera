import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getConversation, getMessages } from "@/lib/data/conversations";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId } = await requireTenant();
    const conversation = await getConversation(organizationId, params.id);
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const messages = await getMessages(params.id);
    return NextResponse.json({ conversation, messages });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
