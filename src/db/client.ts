import Database from "better-sqlite3";
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as sqliteSchema from "./schema-sqlite";
import * as pgSchema from "./schema-pg";
import { isPostgresDatabaseUrl } from "./dialect";
import path from "path";

// Dual-dialect client. SQLite (better-sqlite3) remains the zero-setup local
// default; any postgres:// DATABASE_URL selects pooled PostgreSQL
// (postgres.js) for production. Table objects always come from the matching
// schema file (see ./schema.ts), so every query in lib/data/*.ts runs
// unchanged on both dialects: same tables, same tenant WHERE clauses,
// same .returning() usage.
//
// Typing note: `db` is statically typed as the SQLite drizzle instance so
// all existing query code typechecks exactly as before; at runtime it is
// the correctly-configured dialect instance. Both dialects expose the same
// row shapes (booleans stay booleans, timestamps stay ISO strings, money
// stays integer rupees), which is what makes the single-query-layer design
// sound. The one known behavioral difference is documented in
// getOrganizationRevenueRisk-adjacent helpers: PostgreSQL count(*) arrives
// as text and is normalized with Number() at the read sites.

type AppDb = BetterSQLite3Database<typeof sqliteSchema>;

const globalForDb = globalThis as unknown as {
  sqlite?: Database.Database;
  pgSql?: ReturnType<typeof postgres>;
};

let sqliteDb: Database.Database | undefined;
let pgSql: ReturnType<typeof postgres> | undefined;

// LAZY ON PURPOSE — see getAppDb().
//
// `next build` imports every route module in parallel across a worker pool in
// order to collect page data. With the connection built at module scope, ~10
// route modules raced to open the SAME SQLite file at the same instant, and one
// of them always lost with SQLITE_BUSY. Because Next only reports whichever
// worker failed first, the named victim changed run to run (/api/ai-config on
// Vercel, /api/analytics and /api/auth/resend-verification locally) — the same
// single defect wearing a different route name each time.
//
// Deferring construction to first USE makes importing this module completely
// side-effect free, so page-data collection can load every route safely. The
// first query of the first request pays a one-off open + PRAGMA cost; nothing
// else changes.
let appDb: AppDb | undefined;

function getAppDb(): AppDb {
  if (appDb) return appDb;

  if (isPostgresDatabaseUrl()) {
    // Pool sized for a typical Next.js server process; the singleton below
    // (plus connection reuse across hot-reload) keeps the count bounded.
    pgSql =
      globalForDb.pgSql ??
      postgres(process.env.DATABASE_URL as string, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
      });
    if (process.env.NODE_ENV !== "production") globalForDb.pgSql = pgSql;
    appDb = drizzlePg(pgSql, { schema: pgSchema }) as unknown as AppDb;
    return appDb;
  }

  const dbPath = process.env.DATABASE_URL?.replace("file:", "") || path.join(process.cwd(), "dev.db");
  sqliteDb = globalForDb.sqlite ?? new Database(dbPath);
  // Batch 8 Prompt 2: scheduled workers may run in separate OS processes.
  // Wait briefly on a locked database instead of failing instantly with
  // SQLITE_BUSY; claim contention itself is still handled as "lost race"
  // (skip, never crash) in the scheduler. Read behavior is unchanged.
  //
  // busy_timeout is deliberately set FIRST: it is the pragma that makes the
  // journal_mode/foreign_keys pragmas and the DDL below WAIT for a competing
  // writer instead of throwing SQLITE_BUSY immediately. Applying it last (as
  // before) meant it offered no protection to anything above it.
  sqliteDb.pragma("busy_timeout = 5000");
  sqliteDb.pragma("journal_mode = WAL");
  sqliteDb.pragma("foreign_keys = ON");
  if (process.env.NODE_ENV !== "production") globalForDb.sqlite = sqliteDb;
  appDb = drizzleSqlite(sqliteDb, { schema: sqliteSchema });
  sqlite = sqliteDb;

  // SQLite-only backstop (unchanged legacy behavior): password_reset_tokens
  // predates the drizzle migration history, so it is ensured at runtime.
  // PostgreSQL gets the table from its migration instead (see drizzle/pg).
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (current_timestamp),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS prt_user_idx ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS prt_expiry_idx ON password_reset_tokens(expires_at);
  `);

  // Property media (video) columns. SQLite cannot guard ALTER TABLE ... ADD
  // COLUMN with IF NOT EXISTS, so — exactly like password_reset_tokens above —
  // already-provisioned local databases receive these nullable columns via
  // this additive, idempotent ensure instead of a plain migration that would
  // fail on re-run. PostgreSQL gets the matching ADD COLUMN from its real
  // migration (drizzle/pg/0008_property_media.sql). Strictly additive: no
  // existing column, value, or row is touched.
  const propertyColumns = sqliteDb.prepare("PRAGMA table_info(properties)").all() as Array<{ name?: string }>;
  const propertyColumnNames = new Set(propertyColumns.map((c) => c.name));
  if (!propertyColumnNames.has("video_url")) {
    sqliteDb.exec("ALTER TABLE properties ADD COLUMN video_url TEXT");
  }
  if (!propertyColumnNames.has("video_poster_url")) {
    sqliteDb.exec("ALTER TABLE properties ADD COLUMN video_poster_url TEXT");
  }

  return appDb;
}

/**
 * Stand-in for the drizzle instance that builds it on first property access.
 * Every existing call site keeps working unchanged (`db.select()`, `db.insert()`
 * …); the only difference is WHEN the connection appears. Function properties
 * are bound to the real instance so drizzle's `this`-dependent methods behave
 * exactly as before.
 */
export const db: AppDb = new Proxy({} as AppDb, {
  get(_target, property) {
    const real = getAppDb() as unknown as Record<string | symbol, unknown>;
    const value = real[property];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
  set(_target, property, value) {
    (getAppDb() as unknown as Record<string | symbol, unknown>)[property] = value;
    return true;
  },
  has(_target, property) {
    return property in (getAppDb() as unknown as object);
  },
});

// Legacy export kept for scripts that historically closed the SQLite handle
// directly (see closeDatabase below). Undefined in PostgreSQL mode.
export let sqlite: Database.Database | undefined;

/** Graceful shutdown for scripts (seed/migrate/import). Safe on both dialects. */
export async function closeDatabase(): Promise<void> {
  if (pgSql) await pgSql.end();
  else if (sqliteDb) sqliteDb.close();
}
