import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

/**
 * Central test-database helper (Priority 1).
 *
 * Every database-writing test must resolve its database through here (or
 * through src/test-setup.ts, which uses it). Rules enforced fail-closed:
 *
 * - SQLite test databases must live inside an os.tmpdir()
 *   `basera-test-*` directory created by the current run (proven by a
 *   marker file). Anything else — including dev.db, bare paths, and
 *   relative paths escaping the temp tree — is rejected before any
 *   migration or mutation.
 * - PostgreSQL URLs are never inherited silently: an inherited
 *   postgres:// DATABASE_URL fails closed unless an explicit
 *   BASERA_TEST_PG_URL test database is configured (dedicated PG suites
 *   only; currently blocked — see docs/POSTGRESQL.md).
 * - Cleanup only removes directories it created (marker + run id match);
 *   foreign paths throw instead of deleting.
 */

export const TEST_DB_DIR_PREFIX = "basera-test-";
export const TEST_DB_TEMPLATE_PREFIX = "basera-test-template-";
export const TEST_DB_MARKER = ".basera-test-db";

export interface IsolatedTestDb {
  dir: string;
  dbPath: string;
  dbUrl: string;
  runId: string;
}

function isPostgresUrl(url: string): boolean {
  return /^\s*postgres(ql)?:\/\//i.test(url);
}

function isFileUrl(url: string): boolean {
  return /^\s*file:/i.test(url);
}

/** True only for paths strictly inside os.tmpdir()/<prefix>* (no escapes). */
export function isOwnedTempPath(candidate: string, prefix: string = TEST_DB_DIR_PREFIX): boolean {
  const tmp = path.resolve(os.tmpdir());
  const resolved = path.resolve(candidate);
  if (resolved === tmp) return false;
  if (!resolved.startsWith(tmp + path.sep)) return false;
  const top = resolved.slice(tmp.length + 1).split(path.sep)[0] ?? "";
  return top.startsWith(prefix);
}

export function validateTestDatabaseUrl(url: string | undefined): { dbPath: string } {
  if (url === undefined || url === null || String(url).trim() === "") {
    throw new Error(
      "[test-isolation] Refusing database tests: DATABASE_URL is not set. " +
        "Configure an explicit isolated test database (src/test-setup.ts provisions one automatically)."
    );
  }
  const raw = String(url);
  if (isPostgresUrl(raw)) {
    const explicit = process.env.BASERA_TEST_PG_URL;
    if (!explicit || !/test|localhost|127\.0\.0\.1/i.test(explicit)) {
      throw new Error(
        "[test-isolation] Refusing database tests: inherited a postgres DATABASE_URL " +
          "without an explicit test-database marker. Production-looking connections are never used silently; " +
          "dedicated PG suites require BASERA_TEST_PG_URL (see docs/POSTGRESQL.md)."
      );
    }
    throw new Error(
      "[test-isolation] PostgreSQL-backed suites need dedicated setup (blocked: no PG test instance). " +
        "Set up an isolated PG per docs/POSTGRESQL.md instead of reusing this suite."
    );
  }
  if (!isFileUrl(raw)) {
    throw new Error(
      `[test-isolation] Refusing database tests: only explicit file: URLs are allowed (got ${JSON.stringify(raw.slice(0, 24))}).`
    );
  }
  const filePart = raw.replace(/^\s*file:/i, "").trim();
  const resolved = path.resolve(filePart);
  if (/(^|[/\\])dev\.db(-shm|-wal)?$/i.test(resolved)) {
    throw new Error("[test-isolation] Refusing database tests: target resolves to dev.db.");
  }
  if (!isOwnedTempPath(resolved)) {
    throw new Error(
      `[test-isolation] Refusing database tests: ${resolved} is not inside an os.tmpdir() ${TEST_DB_DIR_PREFIX}* directory.`
    );
  }
  return { dbPath: resolved };
}

function migrationsFingerprint(migrationsFolder: string): string {
  const files = fs
    .readdirSync(migrationsFolder)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const hash = crypto.createHash("sha256");
  for (const f of files) hash.update(fs.readFileSync(path.join(migrationsFolder, f)));
  const journal = path.join(migrationsFolder, "meta", "_journal.json");
  if (fs.existsSync(journal)) hash.update(fs.readFileSync(journal));
  return hash.digest("hex").slice(0, 12);
}

/**
 * Provision a fresh isolated SQLite database: unique temp dir + marker +
 * full migration run. Never touches dev.db. Throws (fail-closed) before
 * returning if any step fails.
 */
export function setupIsolatedTestDb(prefix: string = TEST_DB_DIR_PREFIX): IsolatedTestDb {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const runId = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const dbPath = path.join(dir, "test.db");
  try {
    fs.writeFileSync(path.join(dir, TEST_DB_MARKER), runId, "utf8");
    const fingerprint = migrationsFingerprint(path.join(process.cwd(), "drizzle"));
    const template = path.join(os.tmpdir(), `${TEST_DB_TEMPLATE_PREFIX}${fingerprint}.db`);
    if (!fs.existsSync(template)) {
      const tmpBuild = `${template}.${process.pid}.building`;
      try {
        const handle = new Database(tmpBuild);
        try {
          migrate(drizzle(handle), { migrationsFolder: "./drizzle" });
        } finally {
          handle.close();
        }
        fs.renameSync(tmpBuild, template);
      } catch (err) {
        try {
          fs.rmSync(tmpBuild, { force: true });
        } catch {
          // ignore secondary cleanup failure; primary error below matters
        }
        throw err;
      }
    }
    fs.copyFileSync(template, dbPath);
  } catch (err) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore secondary cleanup failure
    }
    throw err;
  }
  return { dir, dbPath, dbUrl: `file:${dbPath}`, runId };
}

/**
 * Remove an isolated database created by setupIsolatedTestDb. Refuses
 * anything it cannot prove it owns (wrong dir, missing/mismatched marker).
 * Missing directory counts as already clean (idempotent, partial-failure safe).
 */
export function teardownIsolatedTestDb(handle: Pick<IsolatedTestDb, "dir" | "runId">): void {
  const dir = path.resolve(handle.dir);
  if (!isOwnedTempPath(dir)) {
    throw new Error(`[test-isolation] Refusing cleanup: ${dir} is not an owned temp test directory.`);
  }
  if (!fs.existsSync(dir)) return;
  const marker = path.join(dir, TEST_DB_MARKER);
  let markerContent: string | null = null;
  try {
    markerContent = fs.readFileSync(marker, "utf8");
  } catch {
    markerContent = null;
  }
  if (markerContent !== handle.runId) {
    throw new Error(
      `[test-isolation] Refusing cleanup: marker mismatch for ${dir} (not created by this run).`
    );
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Best-effort reaper for stale managed temp dirs (age-gated, prefix + marker required). */
export function reapStaleTestDbs(maxAgeMs: number = 6 * 60 * 60 * 1000): number {
  let removed = 0;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(os.tmpdir());
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith(TEST_DB_DIR_PREFIX) && !entry.startsWith(TEST_DB_TEMPLATE_PREFIX)) continue;
    const dir = path.join(os.tmpdir(), entry);
    try {
      const st = fs.statSync(dir);
      if (!st.isDirectory()) continue;
      if (Date.now() - st.mtimeMs < maxAgeMs) continue;
      if (entry.startsWith(TEST_DB_DIR_PREFIX) && !fs.existsSync(path.join(dir, TEST_DB_MARKER))) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
      // best-effort: never fail a suite on reaper issues
    }
  }
  return removed;
}

export const TEST_RUN_MANIFEST_PREFIX = "basera-test-manifest-";

/**
 * Run manifest: setupFiles records every per-file database it provisions
 * (append-only JSONL, keyed by the parent vitest process) so the
 * globalSetup teardown can remove exactly the current run's resources.
 * Each entry is still ownership-checked by teardownIsolatedTestDb, so a
 * foreign or tampered entry can never cause an unsafe delete.
 */
export function manifestPathForPid(pid: number = process.ppid): string {
  return path.join(os.tmpdir(), `${TEST_RUN_MANIFEST_PREFIX}${pid}.jsonl`);
}

export function recordTestDbForRunCleanup(handle: Pick<IsolatedTestDb, "dir" | "runId">): void {
  try {
    fs.appendFileSync(manifestPathForPid(), `${JSON.stringify({ dir: handle.dir, runId: handle.runId })}\n`, "utf8");
  } catch {
    // best-effort: per-run cleanup is an optimization; stale dirs are
    // still bounded by reapStaleTestDbs.
  }
}

/** Remove exactly this run's manifest-recorded databases. Returns counts. */
export function cleanupRunManifestDbs(pid: number = process.pid): { removed: number; refused: number } {
  let removed = 0;
  let refused = 0;
  const manifest = manifestPathForPid(pid);
  let lines: string[] = [];
  try {
    if (!manifest.startsWith(path.resolve(os.tmpdir()) + path.sep)) return { removed, refused };
    lines = fs.readFileSync(manifest, "utf8").split("\n").filter(Boolean);
  } catch {
    return { removed, refused };
  }
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as { dir: string; runId: string };
      if (typeof entry.dir !== "string" || typeof entry.runId !== "string") {
        refused += 1;
        continue;
      }
      teardownIsolatedTestDb(entry);
      removed += 1;
    } catch {
      refused += 1;
    }
  }
  try {
    fs.rmSync(manifest, { force: true });
  } catch {
    // ignore
  }
  return { removed, refused };
}
