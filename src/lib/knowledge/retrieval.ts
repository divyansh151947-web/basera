import "server-only";
import { db } from "@/db/client";
import { knowledgeDocuments, knowledgeChunks, organizations, properties } from "@/db/schema";
import { and, eq, sql, desc, inArray, isNull } from "drizzle-orm";
import { generateEmbedding, cosineSimilarity, findTopKSimilar, getEmbeddingDimensions } from "./embeddings";
import { parseStoredEmbedding, parseStoredJson } from "./column-shapes";

/**
 * KNOWLEDGE RETRIEVAL SERVICE
 *
 * Semantic search over document chunks with tenant isolation.
 * Supports metadata filtering (project, property, city, locality, tags, etc.)
 * Works with both PostgreSQL (pgvector) and SQLite (application-level similarity).
 */

export type RetrievalFilter = {
  organizationId: string;
  projectId?: string;
  propertyId?: string;
  city?: string;
  locality?: string;
  tags?: string[];
  documentTypes?: string[]; // FAQ, POLICY, DOCUMENT, WEBSITE_CONTENT
  language?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type RetrievalResult = {
  chunkId: string;
  documentId: string;
  content: string;
  score: number;
  metadata: {
    title: string;
    documentType: string;
    projectId?: string;
    propertyId?: string;
    city?: string;
    locality?: string;
    tags?: string[];
    page?: number;
    section?: string;
    heading?: string;
    sourceType: string;
    language?: string;
  };
};

/**
 * Main retrieval function: semantic search with metadata filters
 */
export async function retrieveKnowledge(
  query: string,
  filter: RetrievalFilter,
  opts: { topK?: number; minScore?: number } = {}
): Promise<RetrievalResult[]> {
  const { topK = 8, minScore = 0.65 } = opts;

  // Generate query embedding
  const { embedding: queryEmbedding } = await generateEmbedding(query);

  // Build base query with tenant isolation
  let baseQuery = db
    .select({
      chunk: knowledgeChunks,
      doc: knowledgeDocuments,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
    .where(eq(knowledgeChunks.organizationId, filter.organizationId));

  // Apply metadata filters
  const conditions = [eq(knowledgeChunks.organizationId, filter.organizationId)];

  if (filter.projectId) {
    conditions.push(eq(knowledgeDocuments.projectId, filter.projectId));
  }
  if (filter.propertyId) {
    conditions.push(eq(knowledgeDocuments.propertyId, filter.propertyId));
  }
  if (filter.city) {
    conditions.push(eq(knowledgeDocuments.city, filter.city));
  }
  if (filter.locality) {
    conditions.push(eq(knowledgeDocuments.locality, filter.locality));
  }
  if (filter.language) {
    conditions.push(eq(knowledgeDocuments.language, filter.language));
  }
  if (filter.documentTypes && filter.documentTypes.length > 0) {
    const allowedTypes = ["FAQ", "POLICY", "DOCUMENT", "WEBSITE_CONTENT"] as const;
    const validTypes = filter.documentTypes.filter((t): t is typeof allowedTypes[number] => allowedTypes.includes(t as any));
    if (validTypes.length > 0) {
      conditions.push(inArray(knowledgeDocuments.type, validTypes));
    }
  }
  if (filter.tags && filter.tags.length > 0) {
    // For SQLite: JSON contains check
    // For PG: jsonb @> 
    // We'll handle in application layer for SQLite
  }
  if (filter.dateFrom) {
    conditions.push(sql`${knowledgeDocuments.effectiveDate} >= ${filter.dateFrom}`);
  }
  if (filter.dateTo) {
    conditions.push(sql`${knowledgeDocuments.effectiveDate} <= ${filter.dateTo}`);
  }

  // Only completed documents
  conditions.push(eq(knowledgeDocuments.indexingStatus, "completed"));

  // Execute query
  const results = await db
    .select({
      chunk: knowledgeChunks,
      doc: knowledgeDocuments,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
    .where(and(...conditions));

  // Compute similarity scores (application-level for SQLite, could be DB-level for PG)
  const scored = results.map((row) => {
    // PG vector/jsonb arrive as live values; SQLite text arrives stringified.
    const chunkEmbedding = parseStoredEmbedding(row.chunk.embedding);

    const score = chunkEmbedding.length > 0
      ? cosineSimilarity(queryEmbedding, chunkEmbedding)
      : 0;

    return {
      chunk: row.chunk,
      doc: row.doc,
      score,
    };
  });

  // Filter by min score and sort
  const filtered = scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Apply tag filtering in application layer
  let final = filtered;
  if (filter.tags && filter.tags.length > 0) {
    final = filtered.filter((r) => {
      const docTags = parseStoredJson<string[]>(r.doc.tags, []);
      return filter.tags!.some((tag) => docTags.includes(tag));
    });
  }

  // Map to result format
  return final.map((r) => ({
    chunkId: r.chunk.id,
    documentId: r.chunk.documentId,
    content: r.chunk.content,
    score: Math.round(r.score * 10000) / 10000,
    metadata: {
      title: r.doc.title,
      documentType: r.doc.type,
      projectId: r.doc.projectId || undefined,
      propertyId: r.doc.propertyId || undefined,
      city: r.doc.city || undefined,
      locality: r.doc.locality || undefined,
      tags: parseStoredJson<string[]>(r.doc.tags, []),
      page: parseStoredJson<Record<string, any>>(r.chunk.metadata, {}).page,
      section: parseStoredJson<Record<string, any>>(r.chunk.metadata, {}).section,
      heading: parseStoredJson<Record<string, any>>(r.chunk.metadata, {}).heading,
      sourceType: parseStoredJson<Record<string, any>>(r.chunk.metadata, {}).sourceType || "unknown",
      language: r.doc.language || undefined,
    },
  }));
}

/**
 * Retrieve knowledge for a specific project (property brochure, specs, etc.)
 */
export async function retrieveProjectKnowledge(
  organizationId: string,
  projectId: string,
  query: string,
  topK = 6
): Promise<RetrievalResult[]> {
  return retrieveKnowledge(query, { organizationId, projectId }, { topK, minScore: 0.6 });
}

/**
 * Retrieve knowledge for a specific property/unit
 */
export async function retrievePropertyKnowledge(
  organizationId: string,
  propertyId: string,
  query: string,
  topK = 6
): Promise<RetrievalResult[]> {
  return retrieveKnowledge(query, { organizationId, propertyId }, { topK, minScore: 0.6 });
}

/**
 * Retrieve general FAQ/policy knowledge for organization
 */
export async function retrieveOrgKnowledge(
  organizationId: string,
  query: string,
  topK = 8
): Promise<RetrievalResult[]> {
  return retrieveKnowledge(query, { organizationId, documentTypes: ["FAQ", "POLICY"] }, { topK, minScore: 0.65 });
}

/**
 * Retrieve construction/material knowledge
 */
export async function retrieveConstructionKnowledge(
  organizationId: string,
  query: string,
  topK = 6
): Promise<RetrievalResult[]> {
  return retrieveKnowledge(query, { organizationId, documentTypes: ["DOCUMENT", "WEBSITE_CONTENT"] }, { topK, minScore: 0.6 });
}

/**
 * Format retrieved chunks into a context block for LLM
 */
export function formatKnowledgeContext(results: RetrievalResult[]): string {
  if (results.length === 0) {
    return "No relevant knowledge found in the organization's knowledge base.";
  }

  const lines = [
    "RELEVANT KNOWLEDGE BASE ENTRIES:",
    "",
  ];

  for (const r of results) {
    const meta = r.metadata;
    lines.push(
      `--- Source: ${meta.title} (${meta.documentType}) ${meta.projectId ? `Project: ${meta.projectId}` : ""} ${meta.propertyId ? `Property: ${meta.propertyId}` : ""} ${meta.city ? `City: ${meta.city}` : ""} ${meta.locality ? `Locality: ${meta.locality}` : ""} ---`,
      `Relevance: ${(r.score * 100).toFixed(1)}%`,
      `Content: ${r.content}`,
      ""
    );
  }

  return lines.join("\n");
}

/**
 * Check if organization has any indexed knowledge
 */
export async function hasIndexedKnowledge(organizationId: string): Promise<boolean> {
  const count = await db
    .select({ count: sql<number>`count(*)` })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.organizationId, organizationId), eq(knowledgeDocuments.indexingStatus, "completed")));

  return (count[0]?.count || 0) > 0;
}

/**
 * Get knowledge stats for organization
 */
export async function getKnowledgeStats(organizationId: string): Promise<{
  totalDocuments: number;
  totalChunks: number;
  indexedDocuments: number;
  pendingDocuments: number;
  byType: Record<string, number>;
  byCity: Record<string, number>;
}> {
  const [docs, chunks] = await Promise.all([
    db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.organizationId, organizationId)),
    db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.organizationId, organizationId)),
  ]);

  const byType: Record<string, number> = {};
  const byCity: Record<string, number> = {};

  for (const doc of docs) {
    byType[doc.type] = (byType[doc.type] || 0) + 1;
    if (doc.city) byCity[doc.city] = (byCity[doc.city] || 0) + 1;
  }

  return {
    totalDocuments: docs.length,
    totalChunks: chunks[0]?.count || 0,
    indexedDocuments: docs.filter((d) => d.indexingStatus === "completed").length,
    pendingDocuments: docs.filter((d) => d.indexingStatus !== "completed").length,
    byType,
    byCity,
  };
}