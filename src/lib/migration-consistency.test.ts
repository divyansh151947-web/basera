import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Migration-history consistency (Step 2, Phase E).
 *
 * Guards the exact failure modes found in the audit:
 * - drizzle/0005 was missing statement-breakpoints (fresh migrate failed).
 * - drizzle/0006 duplicated 0001-0005 objects (fresh migrate would fail).
 * - drizzle/pg/0005 existed on disk but was never journaled (never applied).
 * - drizzle/pg lacked the four buyer workspace tables entirely.
 */
const ROOT = process.cwd();

function readJournal(dir: string) {
  const raw = fs.readFileSync(path.join(ROOT, dir, "meta", "_journal.json"), "utf8");
  return JSON.parse(raw) as { entries: Array<{ idx: number; tag: string; when: number }> };
}

function sqlFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(ROOT, dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function createdTables(sql: string): string[] {
  const out: string[] = [];
  const re = /CREATE TABLE ["`]?([A-Za-z0-9_]+)["`]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) out.push(m[1]);
  return out;
}

describe("sqlite migration history", () => {
  it("every journal entry has exactly one matching file and vice versa", () => {
    const journal = readJournal("drizzle");
    const files = sqlFiles("drizzle");
    const tags = journal.entries.map((e) => `${e.tag}.sql`);
    expect([...tags].sort()).toEqual(files);
  });

  it("journal tags and idx values are unique and ordered", () => {
    const journal = readJournal("drizzle");
    const tags = journal.entries.map((e) => e.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it("no CREATE TABLE is duplicated across sqlite migrations", () => {
    const seen = new Map<string, string>();
    for (const file of sqlFiles("drizzle")) {
      const sql = fs.readFileSync(path.join(ROOT, "drizzle", file), "utf8");
      for (const table of createdTables(sql)) {
        expect(seen.has(table), `${table} created in both ${seen.get(table)} and ${file}`).toBe(false);
        seen.set(table, file);
      }
    }
  });

  it("every statement chunk holds a single statement (breakpoint hygiene)", () => {
    for (const dir of ["drizzle", "drizzle/pg"]) {
      for (const file of sqlFiles(dir)) {
        const sql = fs.readFileSync(path.join(ROOT, dir, file), "utf8");
        const chunks = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
        for (const chunk of chunks) {
          const statements = chunk.split(";").map((s) => s.trim()).filter((s) => !s.startsWith("--") && s.length > 0);
          expect(statements.length, `${dir}/${file} has a chunk with ${statements.length} statements`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("buyer_preferences and the buyer workspace tables are migrated", () => {
    const sql = fs.readFileSync(path.join(ROOT, "drizzle", "0005_buyer_tables.sql"), "utf8");
    for (const table of [
      "buyer_preferences",
      "buyer_saved_properties",
      "buyer_property_comparisons",
      "buyer_visit_requests",
      "buyer_recently_viewed",
    ]) {
      expect(sql).toContain(table);
    }
  });
});

describe("postgres migration history", () => {
  it("every journal entry has exactly one matching file and vice versa", () => {
    const journal = readJournal("drizzle/pg");
    const files = sqlFiles("drizzle/pg");
    const tags = journal.entries.map((e) => `${e.tag}.sql`);
    expect([...tags].sort()).toEqual(files);
  });

  it("buyer tables exist in the pg history and match the sqlite set", () => {
    const pgSql = sqlFiles("drizzle/pg")
      .map((f) => fs.readFileSync(path.join(ROOT, "drizzle/pg", f), "utf8"))
      .join("\n");
    for (const table of [
      "buyer_preferences",
      "buyer_saved_properties",
      "buyer_property_comparisons",
      "buyer_visit_requests",
      "buyer_recently_viewed",
    ]) {
      expect(pgSql, `pg history missing ${table}`).toContain(table);
    }
  });
});

describe("drizzle config", () => {
  it("sqlite config points at the sqlite schema (never the dialect-switching re-export)", () => {
    const config = fs.readFileSync(path.join(ROOT, "drizzle.config.ts"), "utf8");
    expect(config).toContain("schema-sqlite.ts");
    expect(config).not.toMatch(/schema:\s*["']\.\/src\/db\/schema\.ts["']/);
  });
});
