# Basera — AI Sales OS for Real Estate (work in progress)

Status: **partial build, in progress**. This is not the final delivery — see
the "What's built" / "What's not built yet" split below before evaluating it.

## Quick start

```bash
cd basera
npm install
cp .env.example .env
# Optional: paste a real key to enable live AI replies
# ANTHROPIC_API_KEY=sk-ant-... in .env

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

Without `ANTHROPIC_API_KEY` set, the AI conversation agent runs in a
rule-based fallback mode (clearly labeled in its replies) so the rest of the
product is still testable. Property matching, lead scoring, and summaries
are deterministic/rule-based regardless — no AI key is needed for those.

## Stack

Next.js 14 (App Router, TypeScript) · Drizzle ORM + SQLite (dev; swap driver
for Postgres in prod — schema is portable) · NextAuth (credentials + JWT) ·
Tailwind · Recharts · Anthropic Claude API for the conversational agent.

**Why Drizzle instead of Prisma:** Prisma's engine binaries require
downloading from `binaries.prisma.sh`, which isn't reachable from this build
sandbox's allowed network list. Drizzle is pure JS/TS with no binary
download step, so it was the safer choice here — it's equally
production-viable and the Postgres migration path is a one-file change
(`src/db/client.ts`).

## What's built and real (not mocked)

- Full multi-tenant schema (22 tables) with tenant isolation enforced at a
  single chokepoint (`src/lib/tenant.ts`) — every data-access function in
  `src/lib/data/*.ts` requires `organizationId` derived server-side from the
  session, never from client input.
- Auth: signup (creates org + trial subscription + Business Admin), login,
  RBAC across 4 roles, protected routes via middleware.
- AI agent, built as separate modules per the spec (not one giant prompt):
  qualification extraction, property matching (deterministic scoring against
  the org's real inventory), knowledge retrieval (grounds answers in the
  org's own DB), handoff manager (rule-based triggers), lead scoring
  (auditable weighted rules, configurable thresholds), summary generator,
  follow-up drafting, and a conversation orchestrator tying them together
  with prompt-injection defenses (untrusted-input wrapping + explicit
  system-prompt rules).
- Working API routes: leads, properties, conversations, the public
  website-chat widget endpoint (the actual lead-capture entry point),
  appointments, analytics, and a secret-protected cron endpoint for
  follow-ups.
- Dashboard UI: sidebar shell, live-data dashboard with real charts (funnel,
  trend, source mix, temperature), leads list + detail (with live
  conversation view, agent takeover, status/assignment controls), properties
  list + add-property flow, login/signup.
- Migrations + seed script with realistic, clearly-labeled demo data.

## What's NOT built yet (stub pages only)

Property detail/edit page, conversations inbox, appointments calendar view,
team management page, analytics page (API already returns real data — just
no page consuming it yet), settings pages (AI config, scoring config,
integrations), super-admin console, the full marketing landing page,
automated tests, and WhatsApp/calendar integration wiring (these need live
third-party credentials regardless).

## Features requiring external credentials (architecture is in place, not wired to a live provider)

- **WhatsApp Business Platform** — `Integration` model + follow-up channel
  routing exist; no Meta/WhatsApp API calls are made yet.
- **Anthropic API key** — required for live AI replies; falls back to
  rule-based responses otherwise (see above).
- **Payment provider** (Razorpay recommended for India) — `Plan`/
  `Subscription` tables exist; no checkout flow yet.
- **Google Calendar** — appointment model supports it; no OAuth/sync yet.

I'll continue building the remaining pages, tests, and docs in the next
message.
