import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import {
  deleteWorkflowDefinition,
  getWorkflowDefinition,
  listWorkflowExecutions,
  recordWorkflowExecution,
  updateWorkflowDefinition,
} from "@/lib/data/workflows";
import { staffApiLimiter, rateLimitedResponse, getClientIp } from "@/lib/rate-limit";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  isEnabled: z.boolean().optional(),
  triggersJson: z.string().optional(),
  conditionsJson: z.string().optional(),
  actionsJson: z.string().optional(),
});

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organizationId, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const { id } = await params;
    const row = await getWorkflowDefinition(organizationId, id);
    if (!row) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    const executions = await listWorkflowExecutions(organizationId, 20);
    const related = executions.filter((e) => e.workflowDefinitionId === id);

    return NextResponse.json({ workflow: row, executions: related });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organizationId, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const { id } = await params;
    const existing = await getWorkflowDefinition(organizationId, id);
    if (!existing) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const row = await updateWorkflowDefinition(organizationId, id, parsed.data);
    return NextResponse.json({ workflow: row });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { organizationId, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const { id } = await params;
    const existing = await getWorkflowDefinition(organizationId, id);
    if (!existing) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });

    await deleteWorkflowDefinition(organizationId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
