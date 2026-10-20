# Basera database backup & recovery

SQLite is the local/dev database (`dev.db`, via `DATABASE_URL=file:...`).
PostgreSQL is selected by any `postgres://` `DATABASE_URL` (production).
Migrations are transactional and tracked by `created_at` in
`__drizzle_migrations`; re-running `npm run db:migrate` is always safe
(it only applies entries newer than the last applied one).

## SQLite backup

```
npm run db:backup
```

- Checkpoints the WAL, copies `dev.db` to `backups/basera-<timestamp>.db`.
- Verifies the copy with `PRAGMA integrity_check` plus a table-count
  comparison; unverified copies are deleted and reported as failure.
- Retention: keeps the newest 14 backups (`BACKUP_KEEP=30 npm run db:backup`
  to override), prunes older files.
- The `backups/` directory is git-ignored. It lives on the same host as the
  database: restrict host/directory access (backups contain password hashes
  and business data). Never copy a backup to a shared or public location,
  never print secrets, and never commit backups to Git.

Schedule: run at least daily on any host holding real data
(Task Scheduler / cron calling `npm run db:backup` in the app directory).

## SQLite restore (tested procedure)

1. Stop the app (releases the WAL).
2. Copy the chosen backup aside first — never restore over your only copy:
   `copy backups\basera-<ts>.db C:\Temp\restore-check.db`
3. Verify the copy:
   `npx tsx src/scripts/backup.ts` is backup-only; for verification open the
   copy read-only and run `PRAGMA integrity_check;` (must return `ok`) and
   compare a few table counts against expectations.
4. Point a test instance at it (`DATABASE_URL=file:C:\Temp\restore-check.db`),
   run `npm run db:migrate` (must exit 0; applies nothing when already current),
   boot the app and spot-check login + buyer/staff dashboards.
5. Only then replace the live file (keep the previous live file as
   `dev.db.pre-restore` until the app is confirmed healthy).

A restore drill following steps 2–4 was last exercised during Step 2
(see the Step 2 report for the exact commands and exit statuses).

## Failed migration / deployment recovery

- `npm run db:migrate` runs inside a transaction: a failed migration rolls
  back and leaves data untouched. Do not re-run with edited history to
  "force" it — read the error, fix the migration file forward, re-run.
- Applied history is matched by timestamp, not file hash; editing an
  already-applied file does not re-apply it, and deleting a pending file
  only stops it from being applied. Never mark migrations applied by hand
  (no manual `INSERT INTO __drizzle_migrations`).
- If a deploy must be rolled back: restore the pre-deploy backup per the
  steps above, then redeploy the previous code. The database and the code
  must always move together (new code ↔ migrated schema).

## PostgreSQL (production)

Runtime-verified here: `src/db/pg-runtime.test.ts` (isolated PostgreSQL 17.4 +
pgvector 0.8.0, in-process; full migrate, upgrade resume, app data layer).
Still required on a real server before production: `verify-pg.ts`, pooling
behavior, extension privileges, and `pg_dump`/`pg_restore` drills.

- Back up with `pg_dump --format=custom` on a schedule; test restores with
  `pg_restore` into an empty database and run the app's migrations against
  the restored copy before trusting it.
- `migrate.ts` applies `./drizzle/pg` when `DATABASE_URL` is `postgres://`.
- Knowledge types: `knowledge_chunks` uses TEXT ids (same `kdoc_`/`kch_` prefixed
  convention as every other table) with a native `vector(1536)` embedding column
  and `jsonb` metadata/tags; SQLite uses the same TEXT ids with JSON-string
  embedding/metadata/tags. A raw SQLite dump cannot be replayed into Postgres;
  use `src/scripts/import-sqlite-to-pg.ts` (review its field mapping first;
  knowledge chunks are excluded — re-index on Postgres instead) and verify
  counts afterwards. Full procedure: `docs/POSTGRESQL.md`.

## Secrets

- Real values live only in `.env` (git-ignored). `.env.example` holds
  placeholders. `git ls-files` must never list `.env`, `*.db`, or `backups/`.
- Logs and error responses must not include tokens, password hashes, or
  email-verification/reset tokens (all auth failure paths return generic
  messages; the WhatsApp webhook returns a generic 401).
