/**
 * Sign-in failure signals the server deliberately exposes to the browser.
 *
 * Free of `"use client"` / `server-only` on purpose: this is the neutral
 * contract shared by the server (`lib/auth.ts`, which *throws* these
 * messages) and both login pages, which *translate* them into copy.
 *
 * WHY THIS EXISTS (next-auth v4 behaviour):
 * - `authorize` rejection → `core/routes/callback.js` returns
 *   `status: 401, redirect: ?error=<encodeURIComponent(error.message)>`.
 * - `signIn(..., { redirect: false })` → `react/index.js` reads that value
 *   back with `new URL(data.url).searchParams.get("error")` and returns it
 *   as `res.error`.
 *
 * So EVERYTHING `authorize` throws is delivered verbatim to the client,
 * including raw SQL/driver text. `lib/auth.ts` therefore treats this map's
 * keys (plus its two control codes) as an allow-list: anything else is
 * logged server-side in full and replaced with `SERVICE_UNAVAILABLE`.
 * Listing a message here is what makes it safe for a user to see it.
 *
 * Two deliberate inclusions:
 * - SERVICE_UNAVAILABLE: an unexpected server/database failure. Detail stays
 *   in the server log; the browser gets honest, non-technical copy instead of
 *   a misleading "Invalid email or password".
 * - rate limiting: an *expected* failure, and showing the real reason is
 *   safer than hiding it — "Invalid email or password" pushes a legitimate
 *   user into a retry loop that deepens their lockout. It reveals nothing
 *   about account existence: limiter budgets are consumed before any account
 *   lookup and identically for addresses that do not exist.
 */
export const AUTH_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  SERVICE_UNAVAILABLE: "We're having trouble signing you in right now. Please try again shortly.",
  "Too many sign-in attempts. Please try again later.":
    "Too many sign-in attempts. Please wait a few minutes and try again.",
};
