# Basera Production Deployment Notes

These notes are deployment-agnostic. The current build targets a long-lived Node.js process with a PostgreSQL database and a writable persistent disk for property media.

## Database
- Use `postgres://...` or `postgresql://...` for `DATABASE_URL` in production. Any `file:` or missing value selects SQLite, which is intended only for local development/import tools.
- Create the schema before serving traffic:
  - `npm run db:migrate`
- For PostgreSQL backups and restore verification, use `pg_dump` / `pg_restore` against an isolated non-production database. Do not point backup/restore scripts at production data during testing.
- SQLite environments can use `npm run db:backup`. Backups are local, verified with `PRAGMA integrity_check`, and subject to `BACKUP_KEEP` retention.

## Secrets and authentication
- `NEXTAUTH_SECRET` and `CRON_SECRET` must be long random values.
- `NEXTAUTH_URL` and `APP_URL` should be the public production HTTPS origin.
- Production startup should fail clearly if mandatory security settings are missing.
- Rotate secrets and database credentials using the hosting provider’s secret management. Never commit `.env`.

## Shared rate limiting
- Local development can leave Upstash variables unset.
- Production, multi-instance deployments should set:
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
  - `RATE_LIMIT_REQUIRE_REDIS=true`
- With `RATE_LIMIT_REQUIRE_REDIS=true`, missing credentials or Redis failures fail closed (`429`) instead of falling back to per-process memory.

## Persistent property media
- Set `MEDIA_STORAGE_DIR` to a writable persistent filesystem location.
- The public chat widget uses `NEXT_PUBLIC_PUBLIC_ORG_SLUG` (`urbannest` by default) for its public workspace. Unknown or blank values fall back to `urbannest`; callers cannot grant cross-tenant access through this client setting.
- The storage driver is local disk today. Ephemeral/serverless compute needs an object-storage adapter before production use; no object-storage SDK is configured, and no provider credentials should be invented.
- Uploads use content-addressing, automatic cleanup of orphaned files, and tenant-scoped resolution.
- Backup media directories and database media references together. Verify database paths still resolve after any restore.

## Health and operational checks
- `/api/healthz` reports only database reachability and timestamp. It does not expose configuration or tenant data.
- Media and AI feature keys remain server-only. Public media is intentionally unauthenticated; management operations require `BUSINESS_ADMIN`/`MANAGER` roles.
- Existing automations, cron, imports, backups, and restore scripts should run in isolated validation environments first.

## Limitations
- Managed PostgreSQL, Upstash Redis, object storage, SMTP, WhatsApp, voice providers, AI embeddings, and cloud restore procedures are NOT TESTED in this repository without real credentials and infrastructure.
- SQLite remains the default local dialect; production operational decisions are still required for pooling and TLS.
- No external account, paid service, or production data operation was created during this phase.