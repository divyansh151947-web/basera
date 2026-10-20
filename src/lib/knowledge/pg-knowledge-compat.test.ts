import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  toStoredJson,
  toStoredEmbedding,
  parseStoredJson,
  parseStoredEmbedding,
  isKnowledgeChunkId,
} from "./column-shapes";
import * as pgSchema from "@/db/schema-pg";

const ROOT = process.cwd();
const PG_URL = "postgres://probe:probe@localhost:5432/probe";
const SQLITE_URL = "file:./dev.db";

function readPg0004(): string {
  return fs.readFileSync(path.join(ROOT, "drizzle", "pg", "0004_knowledge_system.sql"), "utf8");
}

/**
 * PostgreSQL knowledge compatibility (P0).
 *
 * The previous 0004 revision declared `uuid` foreign keys against `text`
 * primary keys, which PostgreSQL rejects — a fresh install could never pass
 * it. These tests pin the corrected contract across migration SQL,
 * drizzle schema, and application write/read shapes. They run on SQLite
 * (static SQL + pure helpers) and must NOT be read as live-PG proof.
 */
describe("pg 0004 knowledge migration compatibility", () => {
  it("knowledge id/reference columns are text (compatible with text PKs)", () => {
    const sql = readPg0004();
    expect(sql).toMatch(/id text PRIMARY KEY NOT NULL/);
    expect(sql).toMatch(/document_id text NOT NULL REFERENCES knowledge_documents\(id\)/);
    expect(sql).toMatch(/organization_id text NOT NULL REFERENCES organizations\(id\)/);
    expect(sql).toMatch(/project_id text REFERENCES properties\(id\)/);
    expect(sql).toMatch(/property_id text REFERENCES properties\(id\)/);
  });

  it("no uuid/bigint/timestamptz knowledge columns remain", () => {
    const sql = readPg0004();
    const body = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(body).not.toMatch(/uuid/i);
    expect(body).not.toMatch(/bigint/i);
    expect(body).not.toMatch(/timestamptz/i);
  });

  it("keeps pgvector support (extension, vector(1536), HNSW)", () => {
    const sql = readPg0004();
    expect(sql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(sql).toMatch(/embedding vector\(1536\) NOT NULL/);
    expect(sql).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
  });

  it("keeps text ISO timestamps with the 0000 default expression", () => {
    const sql = readPg0004();
    expect(sql).toMatch(/created_at text DEFAULT to_char\(\(now\(\) at time zone 'utc'\)/);
    expect(sql).toMatch(/effective_date text/);
    expect(sql).toMatch(/source_file_size integer/);
  });

  it("schema-pg knowledgeChunks matches the corrected migration", () => {
    const cols = pgSchema.knowledgeChunks as Record<string, any>;
    expect(cols.id).toBeTruthy();
    expect(cols.documentId).toBeTruthy();
    expect(cols.organizationId).toBeTruthy();
    // TEXT columns (not uuid): drizzle exposes the underlying data type.
    for (const c of [cols.id, cols.documentId, cols.organizationId]) {
      expect(c.dataType ?? c.constructor?.name).toBeDefined();
    }
    const src = fs.readFileSync(path.join(ROOT, "src", "db", "schema-pg.ts"), "utf8");
    const chunkBlock = src.slice(src.indexOf("export const knowledgeChunks"));
    expect(chunkBlock).not.toMatch(/uuid\(/);
    expect(chunkBlock).toMatch(/vector\("embedding", \{ dimensions: 1536 \}\)/);
  });
});

describe("knowledge column shapes (dialect-aware)", () => {
  it("SQLite keeps the legacy JSON-string shapes", () => {
    expect(toStoredJson(["a", "b"], SQLITE_URL)).toBe('["a","b"]');
    expect(toStoredEmbedding([0.1, 0.2], SQLITE_URL)).toBe("[0.1,0.2]");
  });

  it("PostgreSQL gets live values for jsonb/vector drivers", () => {
    expect(toStoredJson(["a", "b"], PG_URL)).toEqual(["a", "b"]);
    expect(toStoredEmbedding([0.1, 0.2], PG_URL)).toEqual([0.1, 0.2]);
  });

  it("readers accept both shapes without throwing", () => {
    expect(parseStoredJson<string[]>('["x"]', [])).toEqual(["x"]);
    expect(parseStoredJson<string[]>(["x"], [])).toEqual(["x"]);
    expect(parseStoredJson<string[]>(null, ["d"])).toEqual(["d"]);
    expect(parseStoredJson<string>("", "d")).toBe("d");
    expect(parseStoredEmbedding("[0.5,0.25]")).toEqual([0.5, 0.25]);
    expect(parseStoredEmbedding([0.5, 0.25])).toEqual([0.5, 0.25]);
    expect(parseStoredEmbedding(null)).toEqual([]);
    expect(parseStoredEmbedding("")).toEqual([]);
    expect(parseStoredEmbedding("not-json")).toEqual([]);
  });

  it("chunk ids use the kch_ text convention (valid TEXT PK, not strict UUID)", () => {
    const id = `kch_${crypto.randomUUID()}`;
    expect(isKnowledgeChunkId(id)).toBe(true);
    expect(isKnowledgeChunkId(crypto.randomUUID())).toBe(false);
    expect(isKnowledgeChunkId("")).toBe(false);
  });

  it("indexing and retrieval use the dialect helpers", () => {
    const indexing = fs.readFileSync(path.join(ROOT, "src", "lib", "knowledge", "indexing.ts"), "utf8");
    expect(indexing).toContain("toStoredEmbedding(");
    expect(indexing).toContain("toStoredJson(");
    const retrieval = fs.readFileSync(path.join(ROOT, "src", "lib", "knowledge", "retrieval.ts"), "utf8");
    expect(retrieval).toContain("parseStoredEmbedding(");
    expect(retrieval).toContain("parseStoredJson<");
  });
});
