# Basera — Demo & Buyer Guide

This document is for someone evaluating or purchasing the Basera codebase.
It explains how to run a full local demo, what data is fictional, which
features are verified versus external-prerequisite-bound, and what remains
before a production launch.

Everything in this repository runs on a laptop with Node.js 18+ and SQLite.
No paid service, cloud account, or external API key is required for the
demo. When API keys are absent, AI features run in a deterministic
rule-based fallback mode so the product remains fully navigable.

---

## 1. Reproducible local demo

```bash
npm install
cp .env.example .env          # demo works with the template values as-is
npx tsx src/scripts/migrate.ts   # creates dev.db (SQLite) from the schema
npx tsx src/scripts/seed.ts      # loads the "UrbanNest Realty" demo workspace
npm run dev                      # http://localhost:3000
```

`NEXTAUTH_SECRET` in `.env` must be set to any long random string for
sessions to work. The template ships a placeholder; replace it if you see
session errors.

### Demo users (all password `demo1234`)

| Role | Email | Lands on |
|---|---|---|
| Business Admin | `admin@urbannest.demo` | Staff dashboard |
| Manager | `manager@urbannest.demo` | Staff dashboard |
| Sales Agent | `agent1@urbannest.demo` / `agent2@urbannest.demo` | Staff dashboard |
| Super Admin | `superadmin@basera.demo` | Platform console |

All people, properties, leads, and conversations in the seed data are
clearly fictional demo records for the demo workspace "UrbanNest Realty"
(slug `urbannest`). There are no real customers, no real messages, and no
real revenue figures anywhere in this repository.

### Reproducible browser QA (optional)

```bash
npm run e2e
```

This seeds an isolated temporary database, starts a throwaway server on a
fresh port with all paid integrations disabled, runs the full Playwright
browser suite (165 checks across auth, buyer-first navigation, the
change-password journey, property media, buyer journeys, CRM, responsive,
protected modules, security, and a dedicated fixes section covering the
property chat, saved-property deletion, TOTP two-factor, and the dark
Property Preferences dropdowns), and tears everything down. It never
touches `dev.db` and never calls a paid API.

---

## 2. Demo journeys (what to show a buyer)

**Public buyer journey** (no login): home page → Explore → open a property
→ 3D tour → chat with the public AI widget → sign up as a buyer → save a
property → compare two properties → schedule a visit → see it on the
visits page. The public header/footer is buyer-first: **Buyer Login** and
**Create Buyer Account** are the primary actions and **Business Login** is
the secondary link (the old "Create Business Workspace" entry was removed —
business workspaces are seeded, not self-serve).

**AI Property Videos**: the homepage section `#ai-videos` presents a real
demo reel (`public/videos/basera-property-showcase.mp4`, generated from the
repo's own `public/hero-villa.jpg` by `scripts/generate-showcase-video.mjs`,
poster in the same directory). The copy is explicit that Basera does **not**
auto-generate property videos — the reel is a labeled demo asset, and the
section degrades to an "unavailable" state if the file is missing (it
HEAD-probes the asset; it never autoplays with sound).

**Staff journey**: log in as `admin@urbannest.demo` → dashboard with live
charts → Leads list → open a lead → view its conversation → Properties →
**Add property** (two-stage: details first, then an upload panel where
images and a video attach to the property that was just created) → edit a
property → upload/reorder images, cover, and video → Appointments →
Analytics → Settings (WhatsApp integration panel, AI provider config).

**Buyer account journey**: sign up at `/buyer/login` or `/buyer/signup`
(header: *Create Buyer Account*) → Profile & Account page → Account
Security → **Change Password**. The dialog validates inline, verifies the
current password server-side (`POST /api/buyer/change-password`), and
states up front that changing the password **signs you out on all devices**
(the M-1 session binding revokes every session); its success state prompts
you to sign in again with the new password.

Account Security also offers **Two-Factor Authentication**, which is a real
TOTP implementation (RFC 6238), not a stub: *Set up* shows a scannable QR
plus the manual base32 key, enrollment is refused until you submit a valid
code from the authenticator app, ten one-time recovery codes are shown
exactly once, and turning 2FA off requires a fresh code even while signed
in. After it is on, signing in stops at a code step on both `/login` and
`/buyer/login`. *Active Sessions* is still labeled *Coming soon* and is
intentionally not presented as a working control.

**Security story**: a buyer session is redirected off every staff route;
a staff session is redirected off buyer routes; cross-tenant record IDs
return 404 (never another tenant's data); mass-assignment attempts on
signup (role/organizationId) are stripped server-side; login is
rate-limited per account and per IP.

---

## 3. Feature inventory and verification status

Labels used below:

- **VERIFIED LOCALLY** — exercised end-to-end in this repository (browser
  E2E and/or unit/integration tests that pass here).
- **VERIFIED IN ISOLATED INTEGRATION TEST** — logic proven with mocked or
  in-process infrastructure (e.g., PGlite PostgreSQL, stubbed providers);
  no live external service involved.
- **STATICALLY INSPECTED ONLY** — implemented and reviewed, but not proven
  by an automated test run here.
- **BLOCKED BY MISSING INFRASTRUCTURE OR CREDENTIALS** — the code path
  exists; live behavior requires accounts/keys this repository cannot
  provision.
- **NOT IMPLEMENTED** — described honestly as absent.

### VERIFIED LOCALLY (browser E2E and/or passing unit/integration tests)

| Feature | Evidence |
|---|---|
| Staff auth (login, logout, session persistence, safe error messages, evil-callbackUrl neutralization) | E2E `staff-auth` (12/12) + unit tests |
| Buyer auth (signup, duplicate handling, login, logout, session revocation on password rotation) | E2E `buyer-auth` (14/14) |
| Buyer-first public navigation (Buyer Login / Create Buyer Account primary, Business Login secondary) in home + `(public)` header/footer | E2E `buyer-ux` header checks |
| AI Property Videos homepage showcase (real MP4 + poster resolve over HTTP, user-initiated playback, no autoplay, honest "no auto-generation" copy) | E2E `buyer-ux` (section, HEAD 200 asset checks, play interaction) |
| Buyer change-password (dialog a11y, inline validation, server verifies current password, hash rotation, per-user rate limit, sign-out-all-devices messaging) | 10 `change-password.test.ts` unit tests + E2E `buyer-ux` journey (19/19 incl. old-password rejection, new-password sign-in) |
| Two-stage Add Property with media upload (create → attach images/video to the new ID) | E2E `media` (16/16) |
| Property media persistence through Edit Property and buyer-facing display (`/explore`, property page) + anonymous media PATCH rejected | E2E `media` |
| Media upload rejection over real HTTP (unsupported file type and oversized file both refused by the route, with the validator's reason surfaced) | E2E `media` negative checks + `media.test.ts` unit tests |
| Signup mass-assignment defense (role/org injection stripped) | E2E browser+DB check + `buyer-hardening` tests |
| Buyer/staff route firewalls in both directions | E2E middleware checks |
| Public property discovery (explore, detail, unknown id) | E2E `property` + public API checks |
| Buyer save / compare / saved-persistence / refresh persistence | E2E `property` |
| Saved-property deletion that actually persists (dashboard card X, Saved Properties page, and Danger Zone "delete all" all hit real DELETEs scoped to the signed-in buyer) | E2E `fixes` (6 checks incl. reload persistence + server-side confirmation) |
| Property-scoped AI chat ("Chat with AI Assistant" on the property detail page opens the panel, greets with that property's context, and the POST carries that `propertyId`) | E2E `fixes` (5 checks, `14-property-chat-context.png`) — replies served by the deterministic rule-based fallback when providers are unkeyed |
| Two-factor authentication (real TOTP: QR + manual key, enrollment refused until a verified code, one-time recovery codes, login challenge that is fresh/single-use/expiring, disable requires a fresh code and tears down secret + codes + challenges) | 18 unit tests (`two-factor.test.ts`, `two-factor-flow.test.ts`) + E2E `fixes` (14 checks covering the full lifecycle on both login pages) |
| Accessible dark Property Preferences dropdowns (custom control replaces every native `<select>`, dark popup with strong text contrast, Save persists, Clear All submits real nulls) | E2E `fixes` (9 checks incl. computed-color contrast + `10-dark-select-popup.png`) |
| Visit scheduling page and buyer isolation (buyer 2 sees none of buyer 1's state) | E2E `property` |
| Staff CRM: dashboard, leads, lead detail, conversations + message history, appointments, team, analytics, settings | E2E `crm` (12/12) |
| Cross-tenant invisibility (foreign org leads never visible) | E2E API check + `tenant-isolation` tests |
| Responsive layouts across 5 viewports (no horizontal overflow; mobile buyer usable; keyboard focus) | E2E `responsive` (22/22) |
| Protected modules render (settings/WhatsApp area, recovery, voice, 3D tour, homepage 3D canvas) | E2E `protected` |
| Security spot-checks (anon dashboard leaks nothing; injection-shaped IDs → controlled 404) | E2E `security` |
| Public chat widget end-to-end (browser → public chat API → reply) | E2E `protected` widget check (rule-based fallback mode) |
| Public chat API (slug resolution, unknown-workspace 404, lead/conversation session binding, rate budgets) | `public-chat` unit tests + widget E2E |
| Property media validation (magic-byte sniffing, size/type rejection), content-addressed storage, URL safety, gallery reorder/cover rules | `media.test.ts` (60+ assertions) |
| Media upload RBAC (admin/manager only) and tenant-scoped property resolution | `tenant-isolation` / route tests + static review |
| Rate limiting (memory store, Upstash store, fail-closed when required, key hygiene) | `rate-limit*.test.ts` |
| Session security (password-version binding, role hierarchy, logout invalidation) | `session-security.test.ts` + E2E |
| Email verification/reset token logic (expiry, single-use, resend) | `email-verification.test.ts` (mocked delivery) |
| WhatsApp webhook signature verification, idempotency, malformed events | `whatsapp.test.ts` (synthetic events) |
| SQLite backup + verified restore | Verified in isolation on a synthetic DB (integrity check + row read-back) |
| SQLite → PostgreSQL dialect consistency | `migration-consistency.test.ts`, `pg-runtime.test.ts` |
| Type check, lint, unit suite (698/698), drizzle schema check, production build | `VERIFICATION.md` |

### VERIFIED IN ISOLATED INTEGRATION TEST

| Feature | Evidence |
|---|---|
| PostgreSQL runtime behavior | PGlite in-process tests (`src/db/pg-runtime.test.ts`) |
| Voice AI pipeline (session, STT/TTS routing, audio handling) | `voice-session.test.ts` with stubbed providers |
| AI conversation agent behavior (handoff, recovery, injection defense) | `conversation-behavior.test.ts` with mocked providers |
| SMTP/Resend email send paths | `email-smtp.test.ts` / `email-7a.test.ts` (stubbed transports) |

### STATICALLY INSPECTED ONLY

| Feature | Notes |
|---|---|
| Media HTTP-range delivery route | Implementation reviewed (range parsing, 416 handling, immutable caching); not covered by an automated HTTP test |
| Cron endpoints (follow-ups, recovery) | Secret-protected routes reviewed; not exercised end-to-end here |
| Sitemap/robots SEO routes | Render in the production build; content not asserted by tests |

### BLOCKED BY MISSING INFRASTRUCTURE OR CREDENTIALS

| Feature | What's missing |
|---|---|
| Live AI replies (Claude / OpenAI / Gemini) | Provider API key |
| Live email delivery (verification, reset, notifications) | Resend key or SMTP account |
| Live WhatsApp messaging | Meta WhatsApp Business account + webhook secret |
| Live voice STT/TTS | OpenAI key or self-hosted Kokoro endpoint |
| Distributed (multi-instance) rate limiting | Upstash Redis credentials |
| Object-storage media on ephemeral hosts | S3/R2/GCS adapter (local-disk driver ships) |
| Production deployment | No production environment was accessed or tested |

### NOT IMPLEMENTED

| Feature | Notes |
|---|---|
| Payments / billing checkout | `Plan`/`Subscription` tables exist; no checkout flow |
| Google Calendar sync | Appointment model supports it; no OAuth wiring |
| Public business-workspace signup | Intentionally not offered (demo workspaces are seeded) |

---

## 4. Known limitations and external prerequisites

- **Media persistence**: property media is stored on local disk
  (`MEDIA_STORAGE_DIR`, default `<repo>/.uploads`). A production host must
  mount a persistent volume there, or an object-storage adapter must be
  written. This is documented in `DEPLOYMENT.md`.
- **Rate limiting**: production, multi-instance deployments need Upstash
  Redis (`UPSTASH_REDIS_REST_URL/TOKEN` + `RATE_LIMIT_REQUIRE_REDIS=true`),
  otherwise limits are per-process memory only.
- **AI providers**: live conversational replies need one of
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`. Without any,
  replies use the deterministic rule-based fallback (labeled in the UI).
- **Email**: verification and password-reset emails need Resend
  (`RESEND_API_KEY`) or SMTP credentials. In local dev, emails are logged
  or surfaced in the UI instead of being sent.
- **WhatsApp**: webhook signature verification and event handling are
  implemented and tested with synthetic events; live message flow requires
  a Meta WhatsApp Business account and webhook secret.
- **Voice AI**: the pipeline is implemented and tested with stubbed
  providers; live speech-to-text/text-to-speech requires an OpenAI key or a
  self-hosted Kokoro endpoint.
- **Ambient 3D music**: the tour ships a silent-by-default licensed-music
  slot (`public/audio/README.md`); no copyrighted track is bundled.
- **AI property videos**: there is no video-generation pipeline. The
  homepage reel is a pre-rendered demo asset
  (`public/videos/basera-property-showcase.mp4` + poster, both regenerable
  with `node scripts/generate-showcase-video.mjs`, which uses ffmpeg
  against `public/hero-villa.jpg`); the UI says so plainly. Real customer
  videos are uploaded through the property media flows (staff
  Add/Edit Property), stored like images under `MEDIA_STORAGE_DIR`.
- **Payments/billing**: subscription tables exist; no checkout flow is
  implemented.

---

## 5. Buyer handover checklist

Before transferring the codebase, confirm:

1. `npm install && npm run build && npm test && npm run e2e` all pass on a
   clean machine.
2. `npx tsx src/scripts/migrate.ts && npx tsx src/scripts/seed.ts` produce
   a working demo.
3. `.env.example` is copied to `.env` and `NEXTAUTH_SECRET` is replaced.
4. All personal credentials (`.env`) stay with the seller; the buyer
   provisions their own keys.
5. Media directory strategy decided (persistent volume vs. object storage
   adapter).
6. Redis (or equivalent) provisioned for production rate limiting.
7. WhatsApp/Voice/AI/email provider accounts created by the buyer if those
   features are wanted live.
8. No real customer data is included in the transfer — everything in the
   repository is synthetic demo data.
