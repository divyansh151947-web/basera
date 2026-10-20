import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, TenantAuthError } from "@/lib/tenant";
import { getWhatsAppIntegration, upsertWhatsAppIntegration } from "@/lib/data/integrations";

const schema = z.object({ phoneNumberId: z.string().min(1).max(128), displayPhoneNumber: z.string().max(64).optional(), businessAccountId: z.string().max(128).optional() });

export async function GET() {
  try {
    const { organizationId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
    const current = await getWhatsAppIntegration(organizationId);
    return NextResponse.json({ integration: current?.integration ?? null, config: current?.config ?? null, environmentConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) });
  } catch (error) {
    if (error instanceof TenantAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { organizationId } = await requireRole(["BUSINESS_ADMIN"]);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid WhatsApp configuration" }, { status: 400 });
    const integration = await upsertWhatsAppIntegration(organizationId, parsed.data);
    return NextResponse.json({ integration });
  } catch (error) {
    if (error instanceof TenantAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.message.includes("already assigned")) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
