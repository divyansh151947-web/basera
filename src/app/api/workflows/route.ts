import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import {
  createWorkflowDefinition,
  listWorkflowDefinitions,
} from "@/lib/data/workflows";
import { staffApiLimiter, rateLimitedResponse, getClientIp } from "@/lib/rate-limit";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  triggersJson: z.string().refine((v) => {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed);
    } catch {
      return false;
    }
  }, "triggersJson must be a JSON array"),
  conditionsJson: z.string().refine((v) => {
    try {
      JSON.parse(v);
      return true;
    } catch {
      return false;
    }
  }, "conditionsJson must be valid JSON"),
  actionsJson: z.string().refine((v) => {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed);
    } catch {
      return false;
    }
  }, "actionsJson must be a JSON array"),
});

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const rows = await listWorkflowDefinitions(organizationId);
    return NextResponse.json({ workflows: rows });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { organizationId, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const row = await createWorkflowDefinition(organizationId, parsed.data);
    return NextResponse.json({ workflow: row }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
