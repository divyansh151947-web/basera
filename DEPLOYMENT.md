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
- `/api/diagnostics` is the OWNER deployment-truth surface for the public AI + email features (no secrets, no tenant data). It reports: the selected email provider (`smtp` > `resend` > `none`) and sender domain; whether `APP_URL`/`NEXTAUTH_URL` is configured and passes the public-HTTPS guard; the preferred AI provider (`anthropic`/`openai`/`gemini`/`none`); the selected voice provider (`VOICE_PROVIDER` value) and whether it passes its fail-closed configuration check; the served public workspace slug plus whether that organization row exists in the current database; and database reachability. If `publicWorkspace.exists=false`, the website chat widget and Voice AI sessions both fail with 404 `ORG_NOT_FOUND` until the owner resolves it — see the runbook below.
- Media and AI feature keys remain server-only. Public media is intentionally unauthenticated; management operations require `BUSINESS_ADMIN`/`MANAGER` roles.
- Existing automations, cron, imports, backups, and restore scripts should run in isolated validation environments first.

## Public AI runbook (voice + chat) — owner checklist
The public chat widget and Voice AI resolve ONE workspace server-side from
`NEXT_PUBLIC_PUBLIC_ORG_SLUG` (shipped default: `urbannest`, the demo workspace in
`src/scripts/seed.ts`). If that slug has no organization row in the production database,
`POST /api/public/chat` and `POST /api/voice/session` return 404 `ORG_NOT_FOUND`
("Unknown business") and both features are intentionally dead.

To make them work on a deployment:
1. Decide the serving workspace: either run the normal product seed
   (`npm run db:migrate` then `npm run db:seed` — creates the `urbannest` demo workspace
   with ingredients/properties) or point the widgets at an existing real workspace.
2. Set `NEXT_PUBLIC_PUBLIC_ORG_SLUG` in Vercel to that exactly-existing workspace slug
   (case-sensitive; `slugify()` of the workspace name). No redeploy is not enough —
   this variable is a BUILD-time env, so a redeploy IS required after changing it.
3. Verify with `GET /api/diagnostics` → `publicWorkspace.exists` must become `true`.
4. Voice additionally needs a real provider: `VOICE_PROVIDER` (`gemini` | `openai` |
   `kokoro`) plus its server-side key (`GEMINI_API_KEY` / `OPENAI_API_KEY` /
   `KOKORO_BASE_URL`). Unset currently falls back to `mock`, which processes typed
   turns only and never synthesizes audio. Chat AI additionally uses
   `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`/`GEMINI_API_KEY`; `ANTHROPIC_MODEL` can
   override the default Claude model name).

## Email runbook (verification + password reset) — owner checklist
Auth flows work end-to-end already (secure token lifecycle covered by unit tests);
what must be production-configured is DELIVERY:
1. Set `APP_URL` (or `NEXTAUTH_URL`) to the exact public HTTPS origin — links sent in
   emails are built ONLY from it. Production refuses to send links with local/non-HTTPS
   origins (`unsafe_app_url` in logs).
2. Email sending order is SMTP (if `SMTP_HOST`+`SMTP_USER`+`SMTP_PASSWORD` are set) →
   Resend (`RESEND_API_KEY`). Configure exactly one and remove/deactivate stale
   credentials so you know which provider runs; `GET /api/diagnostics` shows the
   selected provider and sender domain.
3. With Resend: verify the sending address or a DOMAIN in the Resend dashboard. The
   fallback sender `onboarding@resend.dev` can deliver ONLY to the account owner's own
   inbox in test mode — other recipients get provider-rejected (classified
   `unverified_sender`, logged server-side, user sees the generic success reply).
4. Delivery outcomes are logged server-side (`[auth] ... accepted and delivered` /
   `accepted but delivery failed`) — Vercel function logs are the way to observe them.

## Limitations
- Managed PostgreSQL, Upstash Redis, object storage, SMTP, WhatsApp, voice providers, AI embeddings, and cloud restore procedures are NOT TESTED in this repository without real credentials and infrastructure.
- SQLite remains the default local dialect; production operational decisions are still required for pooling and TLS.
- No external account, paid service, or production data operation was created during this phase.