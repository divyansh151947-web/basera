import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { staffApiLimiter, rateLimitedResponse, getClientIp } from "@/lib/rate-limit";
import { calculateForecast, DEFAULT_STAGE_PROBABILITIES } from "@/lib/forecasting";
import { z } from "zod";

const stageProbabilitySchema = z.object({
  stage: z.string().min(1),
  probability: z.number().int().min(0).max(100),
});

const forecastQuerySchema = z.object({
  assignedAgentId: z.string().optional(),
  lookbackDays: z.string().optional().transform((v) => (v == null ? undefined : Number.parseInt(v, 10))),
  asOf: z.string().optional(),
});

const forecastBodySchema = z.object({
  stageProbabilities: z.array(stageProbabilitySchema).optional().default([]),
  assignedAgentId: z.string().optional(),
  lookbackDays: z.string().optional().transform((v) => (v == null ? undefined : Number.parseInt(v, 10))),
  asOf: z.string().optional(),
});

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const sp = req.nextUrl.searchParams;
    const parsed = forecastQuerySchema.safeParse({
      assignedAgentId: sp.get("assignedAgentId") ?? undefined,
      lookbackDays: sp.get("lookbackDays") ?? undefined,
      asOf: sp.get("asOf") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    // Agents may only request their own scoped forecast; managers may scope to
    // any agent in their org (assignment is enforced server-side by the
    // service via own+unassigned visibility).
    const requestedAgent = parsed.data.assignedAgentId;
    if (requestedAgent && role !== "BUSINESS_ADMIN" && role !== "MANAGER" && requestedAgent !== userId) {
      return NextResponse.json({ error: "Agents may only view their own forecast." }, { status: 403 });
    }

    const forecast = await calculateForecast(organizationId, {
      asOf: parsed.data.asOf ? new Date(parsed.data.asOf) : undefined,
      assignedAgentId: requestedAgent ?? undefined,
      lookbackDays: parsed.data.lookbackDays,
    });

    return NextResponse.json({ forecast, stageProbabilities: DEFAULT_STAGE_PROBABILITIES });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const body = await req.json();
    const parsed = forecastBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const requestedAgent = parsed.data.assignedAgentId;
    if (requestedAgent && role !== "BUSINESS_ADMIN" && role !== "MANAGER" && requestedAgent !== userId) {
      return NextResponse.json({ error: "Agents may only view their own forecast." }, { status: 403 });
    }

    const forecast = await calculateForecast(organizationId, {
      asOf: parsed.data.asOf ? new Date(parsed.data.asOf) : undefined,
      assignedAgentId: requestedAgent ?? undefined,
      lookbackDays: parsed.data.lookbackDays,
      stageProbabilities: parsed.data.stageProbabilities,
    });

    return NextResponse.json({ forecast });
  } catch (err) {
    return handleError(err);
  }
}
