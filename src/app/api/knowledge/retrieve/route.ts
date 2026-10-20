import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, rateLimitedResponse, knowledgeApiLimiter } from "@/lib/rate-limit";
import { requireTenant, assertTenantScope, TenantAuthError } from "@/lib/tenant";
import { retrieveKnowledge, formatKnowledgeContext, retrieveOrgKnowledge, retrieveProjectKnowledge, retrievePropertyKnowledge, retrieveConstructionKnowledge } from "@/lib/knowledge/retrieval";

const retrieveSchema = z.object({
  query: z.string().min(1).max(2000),
  organizationId: z.string().min(1).max(64),
  projectId: z.string().optional(),
  propertyId: z.string().optional(),
  city: z.string().optional(),
  locality: z.string().optional(),
  tags: z.array(z.string()).optional(),
  documentTypes: z.array(z.enum(["FAQ", "POLICY", "DOCUMENT", "WEBSITE_CONTENT"])).optional(),
  language: z.string().optional(),
  topK: z.number().int().min(1).max(20).default(8),
  minScore: z.number().min(0).max(1).default(0.65),
  mode: z.enum(["general", "project", "property", "org", "construction"]).default("general"),
});

/**
 * POST /api/knowledge/retrieve — Semantic search over knowledge base
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await knowledgeApiLimiter.check(`knowledge:retrieve:${ip}`);
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  const parsed = retrieveSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { query, organizationId, mode, topK, minScore, ...filters } = parsed.data;

  try {
    const { organizationId: sessionOrg } = await requireTenant();
    assertTenantScope(organizationId, sessionOrg);
    let results;

    switch (mode) {
      case "project":
        if (!filters.projectId) {
          return NextResponse.json({ error: "projectId required for project mode" }, { status: 400 });
        }
        results = await retrieveProjectKnowledge(organizationId, filters.projectId, query, topK);
        break;

      case "property":
        if (!filters.propertyId) {
          return NextResponse.json({ error: "propertyId required for property mode" }, { status: 400 });
        }
        results = await retrievePropertyKnowledge(organizationId, filters.propertyId, query, topK);
        break;

      case "org":
        results = await retrieveOrgKnowledge(organizationId, query, topK);
        break;

      case "construction":
        results = await retrieveConstructionKnowledge(organizationId, query, topK);
        break;

      case "general":
      default:
        results = await retrieveKnowledge(query, { organizationId, ...filters }, { topK, minScore });
        break;
    }

    const contextBlock = formatKnowledgeContext(results);

    return NextResponse.json({
      results,
      contextBlock,
      count: results.length,
    });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[knowledge] Retrieval error:", err);
    return NextResponse.json({ error: "Retrieval failed" }, { status: 500 });
  }
}