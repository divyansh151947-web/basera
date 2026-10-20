import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getConversation, getMessages } from "@/lib/data/conversations";
import { getLeadById } from "@/lib/data/leads";
import { requireLeadAccess } from "@/lib/lead-access";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const conversation = await getConversation(organizationId, params.id);
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Same rule as the lead itself: agents reach only threads of leads
    // assigned to them (or unassigned), never a colleague's lead.
    const lead = await getLeadById(organizationId, conversation.leadId);
    requireLeadAccess(role, userId, lead);
    const messages = await getMessages(params.id);
    return NextResponse.json({ conversation, messages });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
