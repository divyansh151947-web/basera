import {
  reapStaleTestDbs,
  recordTestDbForRunCleanup,
  setupIsolatedTestDb,
  validateTestDatabaseUrl,
  type IsolatedTestDb,
} from "./test-utils/test-db";

/**
 * Vitest setup file: runs in every worker BEFORE any test module loads, so
 * even static `import { db } from "@/db/client"` binds the isolated database
 * (src/db/client.ts resolves its path once at module load).
 *
 * - Always provisions a fresh temp SQLite database (migrated) for the test
 *   file, unless BASERA_TEST_DB_URL provides an explicitly validated one.
 * - Fails closed on inherited postgres URLs (never silently testing prod).
 * - Records the handle on globalThis for isolation assertions.
 * - Best-effort reaps stale managed temp dirs from killed runs.
 */

declare global {
  // eslint-disable-next-line no-var
  var __BASERA_TEST_DB__: IsolatedTestDb | undefined;
}

function isPostgresUrl(url: string): boolean {
  return /^\s*postgres(ql)?:\/\//i.test(url);
}

const inherited = process.env.DATABASE_URL;
if (inherited !== undefined && isPostgresUrl(inherited)) {
  const explicit = process.env.BASERA_TEST_PG_URL;
  if (!explicit || !/test|localhost|127\.0\.0\.1/i.test(explicit)) {
    throw new Error(
      "[test-isolation] Refusing test run: inherited a postgres DATABASE_URL without an explicit " +
        "test-database marker. Production-looking connections are never used silently."
    );
  }
  throw new Error(
    "[test-isolation] PostgreSQL-backed suites need dedicated setup (blocked: no PG test instance). " +
      "See docs/POSTGRESQL.md."
  );
}

const explicitTemp = process.env.BASERA_TEST_DB_URL;
let handle: IsolatedTestDb;
if (explicitTemp !== undefined && explicitTemp !== "") {
  // Honor an explicitly chosen temp database, but only after validation.
  validateTestDatabaseUrl(explicitTemp);
  process.env.DATABASE_URL = explicitTemp;
  handle = { dir: "(explicit)", dbPath: explicitTemp.replace(/^\s*file:/i, ""), dbUrl: explicitTemp, runId: "(explicit)" };
} else {
  handle = setupIsolatedTestDb();
  process.env.DATABASE_URL = handle.dbUrl;
  recordTestDbForRunCleanup(handle);
}

globalThis.__BASERA_TEST_DB__ = handle;

reapStaleTestDbs();
