"use client";

/**
 * Post-login routing decision for the separated sign-in pages.
 *
 * next-auth's `signIn(..., { redirect: false })` resolves with only
 * `{ ok, error, status, url }` — it never carries the user's role — so
 * callers must resolve the fresh session (via `getSession()`) and pass the
 * role here. Centralized so both login pages and unit tests share one
 * decision table:
 * - staff page (`/login`): buyers are sent to their workspace instead of
 *   landing on a dashboard they cannot use.
 * - buyer page (`/buyer/login`): staff keep their session but are told to
 *   use the staff login; they are never pushed into the buyer workspace.
 */
export type LoginPage = "staff" | "buyer";

export type LoginDecision = { destination: string } | { error: "wrong-account-type" };

export function resolveLoginDestination(
  role: string | null | undefined,
  page: LoginPage
): LoginDecision {
  if (page === "staff") {
    if (role === "BUYER") return { destination: "/buyer" };
    return { destination: "/dashboard" };
  }
  if (role !== "BUYER") return { error: "wrong-account-type" };
  return { destination: "/buyer" };
}
