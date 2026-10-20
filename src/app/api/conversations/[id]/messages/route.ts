import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getConversation, addMessage, setConversationStatus } from "@/lib/data/conversations";
import { getLeadById } from "@/lib/data/leads";
import { requireLeadAccess } from "@/lib/lead-access";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import { z } from "zod";

const schema = z.object({ content: z.string().min(1).max(4000), takeOver: z.boolean().optional(), returnToAI: z.boolean().optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);
    const conversation = await getConversation(organizationId, params.id);
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Agents may reply only inside threads they are authorized for.
    const lead = await getLeadById(organizationId, conversation.leadId);
    requireLeadAccess(role, userId, lead);

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const message = await addMessage(params.id, "AGENT", parsed.data.content, { senderUserId: userId });

    if (parsed.data.takeOver) {
      await setConversationStatus(organizationId, params.id, "HUMAN_HANDLING", "Sales agent took over conversation");
    } else if (parsed.data.returnToAI) {
      await setConversationStatus(organizationId, params.id, "AI_HANDLING");
    }

    return NextResponse.json({ message });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
