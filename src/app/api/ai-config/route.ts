import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant, requireRole, TenantAuthError } from "@/lib/tenant";
import { getAIConfig, upsertAIConfig } from "@/lib/data/org";

const schema = z.object({
  tone: z.string().trim().min(2).max(60),
  greeting: z.string().trim().min(2).max(500),
  primaryLanguage: z.enum(["auto", "en", "hi", "hinglish"]),
});

export async function GET() {
  try {
    const { organizationId } = await requireTenant();
    const config = await getAIConfig(organizationId);
    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof TenantAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { organizationId } = await requireRole(["BUSINESS_ADMIN"]);
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const config = await upsertAIConfig(organizationId, parsed.data as any);
    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof TenantAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
