import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getConversation, addMessage, setConversationStatus } from "@/lib/data/conversations";
import { z } from "zod";

const schema = z.object({ content: z.string().min(1).max(4000), takeOver: z.boolean().optional(), returnToAI: z.boolean().optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, userId } = await requireTenant();
    const conversation = await getConversation(organizationId, params.id);
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
