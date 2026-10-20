import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { knowledgeDocuments, organizations } from "@/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { getClientIp, rateLimitedResponse, knowledgeApiLimiter } from "@/lib/rate-limit";
import { requireTenant, assertTenantScope, TenantAuthError } from "@/lib/tenant";
import { validateFileForIngestion } from "@/lib/knowledge/document-ingestion";
import { toStoredJson } from "@/lib/knowledge/column-shapes";

const createDocSchema = z.object({
  organizationId: z.string().min(1).max(64),
  type: z.enum(["FAQ", "POLICY", "DOCUMENT", "WEBSITE_CONTENT"]),
  title: z.string().min(1).max(500),
  content: z.string().optional(), // For text-based content
  projectId: z.string().optional(),
  propertyId: z.string().optional(),
  locality: z.string().optional(),
  city: z.string().optional(),
  language: z.string().default("en"),
  effectiveDate: z.string().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

const updateDocSchema = z.object({
  type: z.enum(["FAQ", "POLICY", "DOCUMENT", "WEBSITE_CONTENT"]).optional(),
  title: z.string().min(1).max(500).optional(),
  content: z.string().optional(),
  projectId: z.string().nullable().optional(),
  propertyId: z.string().nullable().optional(),
  locality: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  language: z.string().optional(),
  effectiveDate: z.string().nullable().optional(),
  version: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * GET /api/knowledge/documents — List knowledge documents for an organization
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await knowledgeApiLimiter.check(`knowledge:list:${ip}`);
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");
  const projectId = searchParams.get("projectId");
  const propertyId = searchParams.get("propertyId");
  const city = searchParams.get("city");
  const locality = searchParams.get("locality");
  const type = searchParams.get("type");
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  try {
    const { organizationId: sessionOrg } = await requireTenant();
    assertTenantScope(organizationId, sessionOrg);
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const conditions = [eq(knowledgeDocuments.organizationId, organizationId)];
  if (projectId) conditions.push(eq(knowledgeDocuments.projectId, projectId));
  if (propertyId) conditions.push(eq(knowledgeDocuments.propertyId, propertyId));
  if (city) conditions.push(eq(knowledgeDocuments.city, city));
  if (locality) conditions.push(eq(knowledgeDocuments.locality, locality));
  if (type && ["FAQ", "POLICY", "DOCUMENT", "WEBSITE_CONTENT"].includes(type)) {
    conditions.push(eq(knowledgeDocuments.type, type as "FAQ" | "POLICY" | "DOCUMENT" | "WEBSITE_CONTENT"));
  }
  if (status) conditions.push(eq(knowledgeDocuments.indexingStatus, status));

  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .where(and(...conditions))
    .orderBy(desc(knowledgeDocuments.createdAt))
    .limit(limit)
    .offset(offset);

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(knowledgeDocuments)
    .where(and(...conditions));

  return NextResponse.json({
    documents: docs,
    total: total[0]?.count || 0,
    limit,
    offset,
  });
}

/**
 * POST /api/knowledge/documents — Create a knowledge document
 * For file uploads, use POST /api/knowledge/documents/upload
 * This endpoint is for direct text content creation
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await knowledgeApiLimiter.check(`knowledge:create:${ip}`);
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  const parsed = createDocSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { organizationId: sessionOrg } = await requireTenant();
    assertTenantScope(parsed.data.organizationId, sessionOrg);
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  // Verify organization exists
  const org = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, parsed.data.organizationId))
    .limit(1);

  if (!org[0]) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const [doc] = await db
    .insert(knowledgeDocuments)
    .values({
      id: `kdoc_${crypto.randomUUID()}`,
      organizationId: parsed.data.organizationId,
      type: parsed.data.type,
      title: parsed.data.title,
      content: parsed.data.content || "",
      projectId: parsed.data.projectId || null,
      propertyId: parsed.data.propertyId || null,
      locality: parsed.data.locality || null,
      city: parsed.data.city || null,
      language: parsed.data.language,
      effectiveDate: parsed.data.effectiveDate || null,
      version: parsed.data.version || null,
      tags: toStoredJson(parsed.data.tags),
      processingStatus: parsed.data.content ? "pending" : "completed",
      indexingStatus: parsed.data.content ? "pending" : "completed",
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // If content provided, it will be indexed via separate upload/indexing flow
  return NextResponse.json({ document: doc }, { status: 201 });
}