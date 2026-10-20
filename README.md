# Basera — AI Sales OS for Real Estate

Status: **feature-complete pilot build with an automated verification suite.**
See `docs/BUYER_GUIDE.md` for the honest feature/verification matrix and
known limitations, and `VERIFICATION.md` for the exact commands and results
of the most recent verification run.

## Quick start

```bash
npm install
cp .env.example .env
# Set NEXTAUTH_SECRET in .env to any long random string.
# Optional: paste a real key (ANTHROPIC_API_KEY / OPENAI_API_KEY /
# GEMINI_API_KEY) to enable live AI replies; otherwise the AI runs in a
# deterministic rule-based fallback mode.

npx tsx src/scripts/migrate.ts   # creates dev.db (SQLite) from schema
npx tsx src/scripts/seed.ts      # loads demo org "UrbanNest Realty" + sample data
npm run dev                      # http://localhost:3000
```

Demo logins (all password `demo1234`):

| Role | Email |
|---|---|
| Business Admin | admin@urbannest.demo |
| Manager | manager@urbannest.demo |
| Sales Agent | agent1@urbannest.demo / agent2@urbannest.demo |
| Super Admin | superadmin@basera.demo |

All seeded people, properties, leads, and conversations are fictional demo
records for the demo workspace "UrbanNest Realty" (slug `urbannest`). There
is no real customer data in this repository.

## Stack

Next.js 14 (App Router, TypeScript) · Drizzle ORM — SQLite by default,
PostgreSQL via a `postgres://` `DATABASE_URL` (dual-dialect client and
schemas) · NextAuth (credentials + JWT, password-version session binding) ·
Tailwind · Recharts · three.js 3D property tour · pluggable AI providers
(Anthropic / OpenAI / Gemini, with a rule-based offline fallback) ·
pluggable voice providers (OpenAI realtime/TTS, Kokoro, Gemini TTS).

**Why Drizzle instead of Prisma:** Prisma's engine binaries require
downloading from `binaries.prisma.sh`, which isn't reachable from the build
sandbox's allowed network list. Drizzle is pure JS/TS with no binary download
step and is equally production-viable; the PostgreSQL path is exercised by
in-process PGlite tests (`src/db/pg-runtime.test.ts`).

## What's built and verified

Automated coverage lives in 60 test files (656 unit/integration tests,
`npm test`) plus a 75-check Playwright browser suite (`npm run e2e`) that
covers staff auth, buyer auth, public discovery, buyer save/compare/visits,
CRM (leads, conversations, appointments, analytics, settings), responsive
layouts, protected modules, and security spot-checks. `npm run e2e` seeds
an isolated temporary database and starts a throwaway server with all paid
integrations disabled — it never touches `dev.db` and never calls a paid
API.

- Multi-tenant schema with tenant isolation enforced at a single
  chokepoint (`src/lib/tenant.ts`); every data-access function requires an
  `organizationId` derived server-side from the session.
- Auth: staff signup/login, buyer signup/login, JWT sessions bound to the
  password hash (password change instantly invalidates old sessions), RBAC
  across 5 roles, middleware-protected routes, email verification and
  password-reset flows.
- CRM: leads list/detail, live conversations with agent takeover,
  appointments, analytics dashboards, team page, property management with
  full image/video media lifecycle (content-validated uploads,
  content-addressed storage, gallery reorder, cover selection, HTTP-range
  media delivery).
- Buyer app: explore, property detail, save, compare, schedule visits,
  profile, preferences, recently-viewed — with cross-buyer isolation.
- Public: marketing home with 3D experience, `/explore` discovery, 3D tour
  (`/tour`), AI chat widget (public chat API with rate limits, session
  binding, and tenant isolation), voice demo page.
- AI modules: qualification, property matching, lead scoring, summaries,
  follow-up drafting, knowledge retrieval, handoff detection, revenue
  intelligence, recovery engine — all deterministic or provider-backed.
- Abuse protection: per-account/per-IP login limits, public-chat and voice
  budgets, staff API limits, optional Upstash-Redis distributed store with
  fail-closed mode (`RATE_LIMIT_REQUIRE_REDIS=true`).
- Media: local-disk content-addressed storage with path-traversal guards;
  PostgreSQL migration/verification scripts; SQLite backup script with
  integrity verification and retention.

## What requires external setup (not usable without credentials/infra)

- **Live AI replies** — needs one of the provider API keys (otherwise the
  labeled rule-based fallback answers).
- **Live email delivery** — needs Resend or SMTP credentials.
- **WhatsApp** — webhook signature verification and event handling are
  implemented and unit-tested with synthetic events; live traffic needs a
  Meta WhatsApp Business account + webhook secret.
- **Voice AI** — pipeline implemented and tested against stub providers;
  live STT/TTS needs an OpenAI key or a self-hosted Kokoro endpoint.
- **Object storage** — media is local-disk; ephemeral/serverless hosts need
  a persistent volume or a future S3/R2 adapter.
- **Payments/billing** — subscription tables exist; no checkout flow.

## Operations

- `npm run db:migrate` / `db:seed` / `db:backup` / `db:check` — see
  `docs/BACKUP_RECOVERY.md` and `docs/POSTGRESQL.md`.
- `/api/healthz` — unauthenticated liveness + DB reachability only.
- `DEPLOYMENT.md` — production database, secrets, rate limiting, and media
  persistence requirements.
- `docs/BUYER_GUIDE.md` — demo journeys, feature inventory with verification
  status, known limitations, and the buyer handover checklist.
