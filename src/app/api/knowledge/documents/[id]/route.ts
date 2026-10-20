import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { knowledgeDocuments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getClientIp, rateLimitedResponse, knowledgeApiLimiter } from "@/lib/rate-limit";
import { requireTenant, assertTenantScope, TenantAuthError } from "@/lib/tenant";
import { deleteDocument } from "@/lib/knowledge/indexing";
import { toStoredJson } from "@/lib/knowledge/column-shapes";

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
 * GET /api/knowledge/documents/[id] — Get a single document
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ip = getClientIp(req.headers);
  const rateCheck = await knowledgeApiLimiter.check(`knowledge:get:${ip}`);
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  try {
    const { organizationId: sessionOrg } = await requireTenant();
    const doc = await db
      .select()
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.id, params.id), eq(knowledgeDocuments.organizationId, sessionOrg)))
      .limit(1);

    if (!doc[0]) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Parse tags (stored as a JSON string on SQLite, native JSON on Postgres)
    const rawTags = doc[0].tags as unknown;
    const parsedDoc = {
      ...doc[0],
      tags: typeof rawTags === "string" ? JSON.parse(rawTags || "[]") : (rawTags ?? []),
    };

    return NextResponse.json({ document: parsedDoc });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[knowledge] Get document error:", err);
    return NextResponse.json({ error: "Failed to get document" }, { status: 500 });
  }
}

/**
 * PATCH /api/knowledge/documents/[id] — Update a document
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ip = getClientIp(req.headers);
  const rateCheck = await knowledgeApiLimiter.check(`knowledge:update:${ip}`);
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  const parsed = updateDocSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { organizationId: sessionOrg } = await requireTenant();
    // Check document exists within the caller's organization
    const existing = await db
      .select()
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.id, params.id), eq(knowledgeDocuments.organizationId, sessionOrg)))
      .limit(1);

    if (!existing[0]) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.content !== undefined) updateData.content = parsed.data.content;
    if (parsed.data.projectId !== undefined) updateData.projectId = parsed.data.projectId;
    if (parsed.data.propertyId !== undefined) updateData.propertyId = parsed.data.propertyId;
    if (parsed.data.locality !== undefined) updateData.locality = parsed.data.locality;
    if (parsed.data.city !== undefined) updateData.city = parsed.data.city;
    if (parsed.data.language !== undefined) updateData.language = parsed.data.language;
    if (parsed.data.effectiveDate !== undefined) updateData.effectiveDate = parsed.data.effectiveDate;
    if (parsed.data.version !== undefined) updateData.version = parsed.data.version;
    if (parsed.data.tags !== undefined) updateData.tags = toStoredJson(parsed.data.tags);

    // If content changed, reset indexing status
    if (parsed.data.content !== undefined && parsed.data.content !== existing[0].content) {
      updateData.processingStatus = "pending";
      updateData.indexingStatus = "pending";
      updateData.chunkCount = 0;
    }

    const [doc] = await db
      .update(knowledgeDocuments)
      .set(updateData)
      .where(and(eq(knowledgeDocuments.id, params.id), eq(knowledgeDocuments.organizationId, sessionOrg)))
      .returning();

    return NextResponse.json({ document: doc });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[knowledge] Update document error:", err);
    return NextResponse.json({ error: "Failed to update document" }, { status: 500 });
  }
}

/**
 * DELETE /api/knowledge/documents/[id] — Delete a document
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ip = getClientIp(req.headers);
  const rateCheck = await knowledgeApiLimiter.check(`knowledge:delete:${ip}`);
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  const { searchParams } = new URL(req.url);
  const organizationId = searchParams.get("organizationId");

  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
  }

  try {
    const { organizationId: sessionOrg } = await requireTenant();
    assertTenantScope(organizationId, sessionOrg);
    await deleteDocument(params.id, organizationId);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : "Failed to delete document";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}