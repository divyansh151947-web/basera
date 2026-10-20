import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { knowledgeDocuments, organizations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getClientIp, rateLimitedResponse, knowledgeApiLimiter } from "@/lib/rate-limit";
import { requireTenant, assertTenantScope, TenantAuthError } from "@/lib/tenant";
import { validateFileForIngestion } from "@/lib/knowledge/document-ingestion";
import { indexDocument } from "@/lib/knowledge/indexing";
import { toStoredJson } from "@/lib/knowledge/column-shapes";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const uploadSchema = z.object({
  organizationId: z.string().min(1).max(64),
  type: z.enum(["FAQ", "POLICY", "DOCUMENT", "WEBSITE_CONTENT"]),
  title: z.string().min(1).max(500),
  projectId: z.string().nullish(),
  propertyId: z.string().nullish(),
  locality: z.string().nullish(),
  city: z.string().nullish(),
  language: z.string().default("en"),
  effectiveDate: z.string().nullish(),
  version: z.string().nullish(),
  tags: z.string().nullish(), // JSON string of array
});

/**
 * POST /api/knowledge/documents/upload — Upload and index a document file
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);
  const rateCheck = await knowledgeApiLimiter.check(`knowledge:upload:${ip}`);
  if (!rateCheck.allowed) return rateLimitedResponse(rateCheck.retryAfterMs);

  try {
    const formData = await req.formData();

    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }, { status: 413 });
    }

    // Parse metadata from form
    const metadata = {
      organizationId: formData.get("organizationId") as string,
      type: formData.get("type") as string,
      title: formData.get("title") as string,
      projectId: formData.get("projectId") as string | null,
      propertyId: formData.get("propertyId") as string | null,
      locality: formData.get("locality") as string | null,
      city: formData.get("city") as string | null,
      language: (formData.get("language") as string) || "en",
      effectiveDate: formData.get("effectiveDate") as string | null,
      version: formData.get("version") as string | null,
      tags: formData.get("tags") as string | null,
    };

    const parsed = uploadSchema.safeParse(metadata);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid metadata", details: parsed.error.flatten() }, { status: 400 });
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

    // Validate file type
    const validation = validateFileForIngestion(file.name, file.type, file.size);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Create document record
    const now = new Date().toISOString();
    let tagsArray: unknown = [];
    if (parsed.data.tags) {
      try {
        tagsArray = JSON.parse(parsed.data.tags);
      } catch {
        return NextResponse.json({ error: "Invalid tags: must be a JSON array string" }, { status: 400 });
      }
      if (!Array.isArray(tagsArray)) {
        return NextResponse.json({ error: "Invalid tags: must be a JSON array string" }, { status: 400 });
      }
    }

    const [doc] = await db
      .insert(knowledgeDocuments)
      .values({
        id: `kdoc_${crypto.randomUUID()}`,
        organizationId: parsed.data.organizationId,
        type: parsed.data.type,
        title: parsed.data.title,
        content: "", // Will be populated during indexing
        sourceFileName: file.name,
        sourceFileType: file.type,
        sourceFileSize: file.size,
        projectId: parsed.data.projectId,
        propertyId: parsed.data.propertyId,
        locality: parsed.data.locality,
        city: parsed.data.city,
        language: parsed.data.language,
        effectiveDate: parsed.data.effectiveDate,
        version: parsed.data.version,
        tags: toStoredJson(tagsArray),
        processingStatus: "pending",
        indexingStatus: "pending",
        chunkCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Index document asynchronously (don't await for faster response)
    indexDocument(doc.id, buffer, file.name, file.type)
      .then((result) => {
        console.log(`[knowledge] Document ${doc.id} indexed: ${result.chunksIndexed} chunks, ${result.durationMs}ms`);
      })
      .catch((err) => {
        console.error(`[knowledge] Document ${doc.id} indexing failed:`, err);
      });

    return NextResponse.json(
      {
        document: doc,
        message: "Document uploaded. Indexing started in background.",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[knowledge] Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}