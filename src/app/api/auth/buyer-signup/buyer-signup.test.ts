import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";

vi.mock("server-only", () => ({}));

// Keep the real limiter machinery (other exports in the module are used by
// other units), but never rate-limit these signup probes — count assertions
// must not depend on the shared per-IP window.
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  signupIpLimiter: {
    check: async () => ({ allowed: true, retryAfterMs: 0 }),
  },
}));

// Emails must never leave the test machine: the route treats a failed send
// as "deferred" and still succeeds, so a stubbed success keeps assertions
// focused on the API contract.
vi.mock("@/lib/email", () => ({
  sendVerificationEmail: async () => ({ ok: true }),
}));

import { POST as signupPost } from "./route";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/auth/buyer-signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } as never);
}

const STAMP = Date.now();

/**
 * Buyer-signup API contract (regression): input validation, the safe
 * duplicate-email 409 (case-insensitive), successful registration with a
 * persisted BUYER user, and the requirement that no raw database or
 * infrastructure errors leak into the responses.
 *
 * Runs against the isolated per-worker SQLite database provisioned by
 * src/test-setup.ts — dev.db is never touched.
 */
describe("POST /api/auth/buyer-signup", () => {
  it("registers a new buyer and persists the row (role BUYER)", async () => {
    const email = `qa-signup-${STAMP}@buyers.test`;
    const res = await signupPost(
      post({ name: "QA Signup Buyer", email, password: "SignupPass123!" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("BUYER");
    expect(rows[0].passwordHash).toBeTruthy();
    // A hash, not a plaintext password.
    expect(rows[0].passwordHash.startsWith("$2")).toBe(true);
  });

  it("rejects a duplicate email with the safe 409 EMAIL_EXISTS message", async () => {
    const email = `qa-dupe-${STAMP}@buyers.test`;
    const first = await signupPost(
      post({ name: "QA Dupe Buyer", email, password: "SignupPass123!" })
    );
    expect(first.status).toBe(200);

    const second = await signupPost(
      post({ name: "QA Dupe Two", email, password: "OtherPass456!" })
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error?: string; code?: string };
    expect(body.code).toBe("EMAIL_EXISTS");
    expect(body.error).toMatch(/already registered/i);
    // Safe message: no email echo, no DB internals.
    expect(body.error).not.toContain(email);
    expect(JSON.stringify(body).toLowerCase()).not.toMatch(/constraint|unique violation|sqlite|drizzle/);
  });

  it("treats a different-cased duplicate as the same email (409)", async () => {
    const email = `qa-case-${STAMP}@buyers.test`;
    const first = await signupPost(
      post({ name: "QA Case Buyer", email, password: "SignupPass123!" })
    );
    expect(first.status).toBe(200);

    const again = await signupPost(
      post({ name: "QA Case Two", email: email.toUpperCase(), password: "SignupPass123!" })
    );
    expect(again.status).toBe(409);
    const body = (await again.json()) as { code?: string };
    expect(body.code).toBe("EMAIL_EXISTS");
  });

  it.each([
    ["a non-email address", { name: "QA Bad Email", email: "not-an-email", password: "SignupPass123!" }, /valid email/i],
    ["a too-short password", { name: "QA Short Pass", email: `qa-short-${STAMP}@buyers.test`, password: "short" }, /at least 8/i],
    ["a too-short name", { name: "Q", email: `qa-shortname-${STAMP}@buyers.test`, password: "SignupPass123!" }, /name is required/i],
    ["an empty payload", {}, /.+/],
  ])("400s on %s", async (_label, body, errorPattern) => {
    const res = await signupPost(post(body));
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { error?: string };
    expect(parsed.error).toMatch(errorPattern as RegExp);
  });

  it("keeps infrastructure invariants out of every response", async () => {
    // Sanity sweep across an error path: the bodies must never echo
    // connection strings, SQL, or stack details.
    const res = await signupPost(post({ email: null, password: null }));
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text.toLowerCase()).not.toMatch(/file:|postgres|select|insert|stack/i);
  });
});
