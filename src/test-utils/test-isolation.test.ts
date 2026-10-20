import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  isOwnedTempPath,
  reapStaleTestDbs,
  setupIsolatedTestDb,
  teardownIsolatedTestDb,
  TEST_DB_DIR_PREFIX,
  TEST_DB_MARKER,
  validateTestDatabaseUrl,
} from "./test-db";

/** Captured at module load — before any test hook runs. */
const DB_URL_AT_IMPORT = process.env.DATABASE_URL;
const HANDLE_AT_IMPORT = (globalThis as any).__BASERA_TEST_DB__;

/**
 * Test-database isolation regression tests (Priority 1).
 *
 * Proves the harness, not just the app: the client resolves elsewhere than
 * dev.db, missing/unsafe config fails closed, migrations land only in the
 * isolated file, cleanup cannot escape owned paths, and parallel workers
 * cannot share state (per-file temp databases).
 */
describe("test client resolves an isolated database", () => {
  it("DATABASE_URL is set before test modules load", () => {
    expect(DB_URL_AT_IMPORT).toMatch(/^file:/i);
  });

  it("resolves inside os.tmpdir(), never to dev.db", () => {
    const { dbPath } = validateTestDatabaseUrl(DB_URL_AT_IMPORT);
    expect(isOwnedTempPath(dbPath)).toBe(true);
    expect(dbPath).not.toMatch(/dev\.db/i);
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("setup handle matches the configured database", () => {
    expect(HANDLE_AT_IMPORT?.dbUrl).toBe(DB_URL_AT_IMPORT);
    expect(HANDLE_AT_IMPORT?.dbPath).toBe(validateTestDatabaseUrl(DB_URL_AT_IMPORT).dbPath);
  });
});

describe("fail-closed configuration", () => {
  it("missing DATABASE_URL throws before any mutation", () => {
    expect(() => validateTestDatabaseUrl(undefined)).toThrow(/not set/);
    expect(() => validateTestDatabaseUrl("")).toThrow(/not set/);
  });

  it("dev.db targets are rejected in every spelling", () => {
    for (const url of ["file:./dev.db", "file:dev.db", `file:${path.join(process.cwd(), "dev.db")}`]) {
      expect(() => validateTestDatabaseUrl(url)).toThrow(/dev\.db|owned temp/i);
    }
  });

  it("non-file schemes and bare paths are rejected", () => {
    expect(() => validateTestDatabaseUrl("dev.db")).toThrow(/only explicit file:/);
    expect(() => validateTestDatabaseUrl("/tmp/some.db")).toThrow(/only explicit file:/);
  });

  it("production-looking postgres URLs are rejected silently-never", () => {
    expect(() => validateTestDatabaseUrl("postgres://admin:secret@db.internal:5432/basera")).toThrow(
      /never used silently/
    );
  });

  it("paths escaping the temp tree are rejected", () => {
    expect(() => validateTestDatabaseUrl(`file:${os.tmpdir()}/../escape.db`)).toThrow(/not inside/);
    expect(() => validateTestDatabaseUrl(`file:${os.tmpdir()}`)).toThrow(/not inside/);
  });
});

describe("migration + fixture separation", () => {
  it("two isolated databases do not share state", () => {
    const a = setupIsolatedTestDb();
    const b = setupIsolatedTestDb();
    try {
      expect(a.dbPath).not.toBe(b.dbPath);
      const ha = new Database(a.dbPath);
      const hb = new Database(b.dbPath);
      try {
        ha.prepare("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)").run("org-a", "A", "a");
        const inB = hb.prepare("SELECT COUNT(*) AS c FROM organizations WHERE id = ?").get("org-a") as { c: number };
        expect(inB.c).toBe(0);
        // Migrations applied in both (organizations table exists with seeded shape).
        const tables = hb.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get() as { c: number };
        expect(tables.c).toBeGreaterThan(20);
      } finally {
        ha.close();
        hb.close();
      }
    } finally {
      teardownIsolatedTestDb(a);
      teardownIsolatedTestDb(b);
    }
    expect(fs.existsSync(a.dir)).toBe(false);
    expect(fs.existsSync(b.dir)).toBe(false);
  });
});

describe("cleanup cannot escape owned paths", () => {
  it("refuses foreign directories and leaves them intact", () => {
    const decoyDir = fs.mkdtempSync(path.join(os.tmpdir(), "basera-NOTATEST-"));
    const decoyFile = path.join(decoyDir, "precious.txt");
    fs.writeFileSync(decoyFile, "do not delete");
    try {
      expect(() => teardownIsolatedTestDb({ dir: decoyDir, runId: "forged" })).toThrow(/not an owned temp/);
      expect(() => teardownIsolatedTestDb({ dir: process.cwd(), runId: "forged" })).toThrow(/not an owned temp/);
      expect(() => teardownIsolatedTestDb({ dir: os.tmpdir(), runId: "forged" })).toThrow(/not an owned temp/);
      expect(fs.existsSync(decoyFile)).toBe(true);
    } finally {
      fs.rmSync(decoyDir, { recursive: true, force: true });
    }
  });

  it("refuses marker mismatch and is idempotent", () => {
    const owned = setupIsolatedTestDb();
    expect(() => teardownIsolatedTestDb({ dir: owned.dir, runId: "wrong-run-id" })).toThrow(/marker mismatch/);
    expect(fs.existsSync(owned.dir)).toBe(true);
    teardownIsolatedTestDb(owned);
    expect(fs.existsSync(owned.dir)).toBe(false);
    expect(() => teardownIsolatedTestDb(owned)).not.toThrow();
  });

  it("reaps only stale managed dirs", () => {
    const stale = path.join(os.tmpdir(), `${TEST_DB_DIR_PREFIX}stale-reap-check`);
    const fresh = path.join(os.tmpdir(), `${TEST_DB_DIR_PREFIX}fresh-reap-check`);
    fs.rmSync(stale, { recursive: true, force: true });
    fs.rmSync(fresh, { recursive: true, force: true });
    fs.mkdirSync(stale, { recursive: true });
    fs.mkdirSync(fresh, { recursive: true });
    fs.writeFileSync(path.join(stale, TEST_DB_MARKER), "x");
    fs.writeFileSync(path.join(fresh, TEST_DB_MARKER), "x");
    const old = Date.now() - 8 * 60 * 60 * 1000;
    fs.utimesSync(stale, new Date(old), new Date(old));
    try {
      const removed = reapStaleTestDbs();
      expect(removed).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(stale)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
      fs.rmSync(stale, { recursive: true, force: true });
    }
  });
});
