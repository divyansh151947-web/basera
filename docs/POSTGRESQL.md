# Basera PostgreSQL deployment & verification

PostgreSQL is selected by any `postgres://` / `postgresql://` `DATABASE_URL`
(see `src/db/dialect.ts`). SQLite remains the local-dev default.

## Automated runtime verification (no server needed)

`src/db/pg-runtime.test.ts` executes the REAL `drizzle/pg` migration history,
schema, and application data layer against an isolated in-process PostgreSQL
**17.4 + pgvector 0.8.0** (`@electric-sql/pglite@0.3.4` devDependency —
pinned because it bundles pgvector; newer 0.5.x builds dropped the bundle).
It covers: fresh install (31 tables, 7 journal markers), idempotent re-run,
timestamp-resume upgrade from a 0000-state database, tenant isolation
(data layer + API), buyer ownership incl. ghost-ID rejection, knowledge
documents/tags/chunks with real `kch_` ids and 1536-dim vectors, pgvector
`<=>` distance, FK enforcement + cascade, ISO dates, integer money,
aggregates, visits, and email verification. Embeddings use fixed synthetic
vectors (database check only — not an AI-provider check).

What PGlite does NOT prove (still requires an isolated real server):
`postgres.js` pooling/TCP behavior, superuser-gated `CREATE EXTENSION` on
managed hosts, `pg_dump`/`pg_restore`, and production performance. Run
`src/scripts/verify-pg.ts` there before any production claim.

## Prerequisites

- PostgreSQL **15+** with **pgvector** installed (`CREATE EXTENSION IF NOT EXISTS
  vector` runs in `drizzle/pg/0004_knowledge_system.sql`). The database role
  must be allowed to create the extension, or a superuser must pre-install it.
- `EMBEDDING_MODEL=text-embedding-3-small` (1536 dims, the default).
  `text-embedding-3-large` (3072 dims) does **not** fit `vector(1536)`; indexing
  refuses it with a clear error on PostgreSQL.
- ID convention: all tables use **TEXT** primary keys (`kdoc_` / `kch_` prefixed
  app-generated IDs). Do not switch knowledge columns to `uuid`.

## Fresh install (repeatable)

```
# against an EMPTY database:
DATABASE_URL="postgresql://user:pass@host:5432/basera" npm run db:migrate
DATABASE_URL="postgresql://user:pass@host:5432/basera" npx tsx src/scripts/verify-pg.ts
```

`db:migrate` applies `./drizzle/pg` sequentially via the real migrator (safe to
re-run; applied state lives in `__drizzle_migrations`). `verify-pg.ts` runs 22
checks on a temp org (`pg-verify`) plus the seeded demo org and cleans up after
itself. Expect `22/22 PostgreSQL checks passed.`

## Upgrade from an earlier PG state

1. `pg_dump --format=custom` backup first.
2. `npm run db:migrate` against the target (applies only entries newer than the
   last applied `created_at`; never deletes data).
3. Re-run `verify-pg.ts`; spot-check login + dashboards.

## Note on `0004_knowledge_system.sql` history

The PG migration set is pre-release (never committed to a release, never
applied to a persistent database — the previous file revision could not have
succeeded: `uuid` foreign keys against `text` primary keys are rejected by
PostgreSQL). `0004` was therefore corrected in place to TEXT ids/refs/dates
before the first PostgreSQL release. If some database out there applied the old
revision, it cannot be in the applied state (the migrator records a migration
only after its statements succeed; a failed `0004` is retried, not skipped) —
re-running `db:migrate` with the corrected file is the remediation.

## What is NOT covered here

Live PG runtime (fresh install, upgrade, `verify-pg.ts`) still requires an
isolated PostgreSQL 15+ with pgvector; it has not been executed in this
environment. SQLite import: `src/scripts/import-sqlite-to-pg.ts` copies
business tables (knowledge chunks excluded — re-index on PG instead).
