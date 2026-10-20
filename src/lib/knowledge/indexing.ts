import "server-only";
import { db } from "@/db/client";
import { knowledgeDocuments, knowledgeChunks } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { ingestDocument, IngestionResult, validateFileForIngestion } from "./document-ingestion";
import { generateEmbeddings, getEmbeddingDimensions } from "./embeddings";
import { isPostgresDatabaseUrl } from "@/db/dialect";
import { toStoredEmbedding, toStoredJson } from "./column-shapes";

/** PostgreSQL `vector(1536)` dimension: enforced before insert so a model
 *  mismatch fails with a clear message instead of a cryptic DB error. */
const PG_VECTOR_DIMENSIONS = 1536;

/**
 * KNOWLEDGE INDEXING SERVICE
 *
 * Processes uploaded documents:
 * 1. Parse document into chunks
 * 2. Generate embeddings for chunks
 * 3. Store chunks with embeddings in database
 * 4. Update document status
 */

export type IndexingResult = {
  documentId: string;
  chunksIndexed: number;
  totalChars: number;
  estimatedTokens: number;
  durationMs: number;
};

export type IndexingStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Process a document for indexing
 */
export async function indexDocument(
  documentId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<IndexingResult> {
  const startTime = Date.now();

  // Update status to processing
  await db
    .update(knowledgeDocuments)
    .set({ processingStatus: "processing", indexingStatus: "indexing", updatedAt: new Date().toISOString() })
    .where(eq(knowledgeDocuments.id, documentId));

  try {
    // Validate
    const validation = validateFileForIngestion(fileName, mimeType, fileBuffer.length);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Ingest document into chunks
    const ingestionResult = await ingestDocument(fileBuffer, fileName, mimeType);

    if (ingestionResult.chunks.length === 0) {
      throw new Error("No content extracted from document");
    }

    // Generate embeddings for all chunks
    const texts = ingestionResult.chunks.map((c) => c.content);
    const { embeddings, usage } = await generateEmbeddings(texts);

    if (embeddings.length !== texts.length) {
      throw new Error("Embedding count mismatch");
    }

    // PostgreSQL stores embeddings in a fixed-dimension vector column;
    // fail with a clear message instead of a driver type error.
    if (isPostgresDatabaseUrl() && getEmbeddingDimensions() !== PG_VECTOR_DIMENSIONS) {
      throw new Error(
        `Embedding model produces ${getEmbeddingDimensions()} dimensions but PostgreSQL knowledge_chunks.embedding is vector(${PG_VECTOR_DIMENSIONS}). Set EMBEDDING_MODEL=text-embedding-3-small.`
      );
    }

    // Store chunks with embeddings (dialect-aware shapes: live values for
    // PostgreSQL vector/jsonb, JSON strings for SQLite text/blob).
    const chunkValues = ingestionResult.chunks.map((chunk, i) => ({
      id: `kch_${crypto.randomUUID()}`,
      documentId,
      organizationId: "", // Will be filled from document
      chunkIndex: chunk.index,
      content: chunk.content,
      embedding: toStoredEmbedding(embeddings[i]),
      metadata: toStoredJson(chunk.metadata),
      createdAt: new Date().toISOString(),
    }));

    // Get organizationId from document
    const doc = await db
      .select({ organizationId: knowledgeDocuments.organizationId })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, documentId))
      .limit(1);

    if (!doc[0]) {
      throw new Error("Document not found");
    }

    const organizationId = doc[0].organizationId;

    // Update chunks with organizationId
    chunkValues.forEach((c) => (c.organizationId = organizationId));

    // Insert chunks in batches
    const batchSize = 50;
    for (let i = 0; i < chunkValues.length; i += batchSize) {
      const batch = chunkValues.slice(i, i + batchSize);
      await db.insert(knowledgeChunks).values(batch as any);
    }

    // Update document with chunk count and status
    await db
      .update(knowledgeDocuments)
      .set({
        chunkCount: ingestionResult.chunks.length,
        processingStatus: "completed",
        indexingStatus: "completed",
        updatedAt: new Date().toISOString(),
        errorMessage: null,
      })
      .where(eq(knowledgeDocuments.id, documentId));

    return {
      documentId,
      chunksIndexed: ingestionResult.chunks.length,
      totalChars: ingestionResult.totalChars,
      estimatedTokens: ingestionResult.estimatedTokens,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await db
      .update(knowledgeDocuments)
      .set({
        processingStatus: "failed",
        indexingStatus: "failed",
        errorMessage,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(knowledgeDocuments.id, documentId));

    throw err;
  }
}

/**
 * Re-index a document (delete existing chunks and re-process)
 */
export async function reindexDocument(documentId: string): Promise<IndexingResult> {
  // Get document info
  const doc = await db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .limit(1);

  if (!doc[0]) {
    throw new Error("Document not found");
  }

  // For re-indexing, we need the original file - this would require
  // storing the file or having it re-uploaded. For now, we'll just
  // clear chunks and mark as pending.
  await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, documentId));
  await db
    .update(knowledgeDocuments)
    .set({
      chunkCount: 0,
      processingStatus: "pending",
      indexingStatus: "pending",
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(knowledgeDocuments.id, documentId));

  throw new Error("Re-indexing requires re-uploading the file. Please upload the document again.");
}

/**
 * Delete a document and its chunks
 */
export async function deleteDocument(documentId: string, organizationId: string): Promise<void> {
  // Verify ownership
  const doc = await db
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.organizationId, organizationId)))
    .limit(1);

  if (!doc[0]) {
    throw new Error("Document not found or access denied");
  }

  // Delete chunks first (FK cascade would handle this, but explicit is clearer)
  await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, documentId));

  // Delete document
  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId));
}

/**
 * Bulk index multiple documents
 */
export async function bulkIndexDocuments(
  documents: Array<{ id: string; buffer: Buffer; fileName: string; mimeType: string }>
): Promise<Array<IndexingResult | { id: string; error: string }>> {
  const results: Array<IndexingResult | { id: string; error: string }> = [];

  for (const doc of documents) {
    try {
      const result = await indexDocument(doc.id, doc.buffer, doc.fileName, doc.mimeType);
      results.push(result);
    } catch (err) {
      results.push({ id: doc.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return results;
}

/**
 * Get documents pending indexing
 */
export async function getPendingIndexing(organizationId: string, limit = 50) {
  return db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.organizationId, organizationId),
        sql`${knowledgeDocuments.indexingStatus} IN ('pending', 'processing')`
      )
    )
    .orderBy(knowledgeDocuments.createdAt)
    .limit(limit);
}

/**
 * Get documents with failed indexing for retry
 */
export async function getFailedIndexing(organizationId: string, limit = 50) {
  return db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.organizationId, organizationId),
        eq(knowledgeDocuments.indexingStatus, "failed")
      )
    )
    .orderBy(knowledgeDocuments.updatedAt)
    .limit(limit);
}