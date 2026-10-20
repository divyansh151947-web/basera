import { isPostgresDatabaseUrl } from "@/db/dialect";

/**
 * KNOWLEDGE COLUMN SHAPES (SQLite vs PostgreSQL).
 *
 * SQLite stores JSON payloads as TEXT (stringified) and embeddings as a
 * JSON blob; PostgreSQL uses native `jsonb` and `vector(1536)` columns whose
 * drizzle drivers expect live JS values (object/array) and serialize
 * themselves. Passing a pre-stringified string to the PG driver would
 * double-encode the value, and passing a string to `vector` would fail.
 *
 * These helpers branch on the active DATABASE_URL so each dialect gets the
 * shape its driver requires. Behavior on SQLite (dev + all current tests)
 * is byte-identical to before. `url` is injectable so tests can cover both
 * shapes without mutating process.env.
 */

type JsonValue = unknown;

export function toStoredJson(value: JsonValue, url: string | undefined = process.env.DATABASE_URL): any {
  if (isPostgresDatabaseUrl(url)) return value ?? null;
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export function toStoredEmbedding(values: number[], url: string | undefined = process.env.DATABASE_URL): any {
  if (!Array.isArray(values)) return null;
  if (isPostgresDatabaseUrl(url)) return values;
  return JSON.stringify(values);
}

export function parseStoredJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== "string") return raw as T;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

export function parseStoredEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // Handles both JSON arrays ("[0.1,0.2]") and pgvector text ("[0.1,0.2]").
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "number" && Number.isFinite(v));
    return [];
  } catch {
    return [];
  }
}

/** Preferred chunk-id shape: `kch_<uuid>` text (accepted by TEXT PKs on both dialects). */
export function isKnowledgeChunkId(value: unknown): value is string {
  return typeof value === "string" && /^kch_[0-9a-fA-F-]{36}$/.test(value);
}
