import { NextRequest, NextResponse } from "next/server";
import { requireTenant, TenantAuthError } from "@/lib/tenant";
import { getLeadById } from "@/lib/data/leads";
import { isLeadAuthorized } from "@/lib/lead-access";
import { matchProperties, searchProperties, type MatchCriteria } from "@/lib/ai/property-matching";
import { saveMatchedInterests } from "@/lib/data/leads";
import { staffApiLimiter, rateLimitedResponse, getClientIp } from "@/lib/rate-limit";
import { z } from "zod";

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

const toOptionalInt = (v: string | undefined): number | undefined => {
  if (v == null || v === "") return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
};

const matchCriteriaSchema = z.object({
  city: z.string().optional(),
  preferredCity: z.string().optional(),
  locality: z.string().optional(),
  preferredLocality: z.string().optional(),
  bhk: z.preprocess(toOptionalInt, z.number().int().min(1).max(10).optional()),
  propertyType: z.string().optional(),
  budgetMinInr: z.preprocess(toOptionalInt, z.number().int().min(0).optional()),
  budgetMaxInr: z.preprocess(toOptionalInt, z.number().int().min(0).optional()),
  availability: z.string().optional(),
  limit: z.preprocess(toOptionalInt, z.number().int().min(1).max(50).optional().default(5)),
});

/** GET /api/properties/match?leadId=... — match a stored lead against org inventory. */
export async function GET(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const sp = req.nextUrl.searchParams;
    const leadId = sp.get("leadId");

    let criteria: MatchCriteria | null = null;
    let leadName: string | null = null;
    let limit = 5;

    if (leadId) {
      const lead = await getLeadById(organizationId, leadId);
      if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      if (!isLeadAuthorized(role, userId, lead)) {
        return NextResponse.json({ error: "Not authorized to access this lead" }, { status: 403 });
      }
      leadName = lead.name ?? null;
      limit = sp.get("limit") ? Number.parseInt(sp.get("limit")!) || 5 : 5;
      criteria = {
        city: lead.preferredCity ?? undefined,
        preferredCity: lead.preferredCity ?? undefined,
        locality: lead.preferredLocality ?? undefined,
        preferredLocality: lead.preferredLocality ?? undefined,
        bhk: lead.bhk ?? undefined,
        propertyType: lead.propertyType ?? undefined,
        budgetMinInr: lead.budgetMinInr ?? undefined,
        budgetMaxInr: lead.budgetMaxInr ?? undefined,
      };
    } else {
      const parsed = matchCriteriaSchema.safeParse({
        city: sp.get("city") ?? undefined,
        preferredCity: sp.get("preferredCity") ?? undefined,
        locality: sp.get("locality") ?? undefined,
        preferredLocality: sp.get("preferredLocality") ?? undefined,
        bhk: sp.get("bhk") ?? undefined,
        propertyType: sp.get("propertyType") ?? undefined,
        budgetMinInr: sp.get("budgetMinInr") ?? undefined,
        budgetMaxInr: sp.get("budgetMaxInr") ?? undefined,
        availability: sp.get("availability") ?? undefined,
        limit: sp.get("limit") ?? undefined,
      });
      if (!parsed.success) {
        return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
      }
      // `limit` is parsed by the schema but is not part of MatchCriteria — split it out.
      const { limit: parsedLimit, ...rest } = parsed.data;
      criteria = rest as MatchCriteria;
      limit = parsedLimit ?? 5;
    }

    const result = await searchProperties(organizationId, criteria ?? {}, limit);

    return NextResponse.json({
      leadId,
      leadName,
      mode: result.mode,
      gap: result.gap,
      matches: result.matches.map((m) => ({
        property: m.property,
        matchType: m.matchType,
        matchScore: m.matchScore,
        reasons: m.reasons,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

/** POST /api/properties/match — match ad-hoc criteria and optionally save interests for a lead. */
export async function POST(req: NextRequest) {
  try {
    const { organizationId, role, userId } = await requireTenant();
    const ip = getClientIp(req.headers);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${ip}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const body = await req.json();
    const parsed = matchCriteriaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    // `limit` is parsed by the schema but is not part of MatchCriteria — split it out.
    const { limit: parsedLimit, ...rest } = parsed.data;
    const criteria = rest as MatchCriteria;
    const limit = parsedLimit ?? 5;

    const result = await searchProperties(organizationId, criteria, limit);

    // Optionally persist the matches as lead interests when a leadId is supplied.
    const leadId = body.leadId;
    if (leadId) {
      const lead = await getLeadById(organizationId, leadId);
      if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      if (!isLeadAuthorized(role, userId, lead)) {
        return NextResponse.json({ error: "Not authorized to access this lead" }, { status: 403 });
      }
      await saveMatchedInterests(
        organizationId,
        leadId,
        result.matches.map((m) => ({
          propertyId: m.property.id,
          matchType: m.matchType,
          matchScore: m.matchScore,
        })),
      );
    }

    return NextResponse.json({
      leadId,
      mode: result.mode,
      gap: result.gap,
      matches: result.matches.map((m) => ({
        property: m.property,
        matchType: m.matchType,
        matchScore: m.matchScore,
        reasons: m.reasons,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
