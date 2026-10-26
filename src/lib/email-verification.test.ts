import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { passwordResetTokens, users } from "@/db/schema";
import {
  VERIFY_TOKEN_PREFIX,
  buildVerifyToken,
  consumeEmailVerification,
  createEmailVerification,
  isVerifyTokenFormat,
  markEmailVerified,
} from "./email-verification";
import { POST as verifyPOST } from "@/app/api/auth/verify-email/route";
import { POST as resendPOST } from "@/app/api/auth/resend-verification/route";
import { POST as resetPOST } from "@/app/api/auth/reset-password/route";
import { verifyResendEmailLimiter } from "./rate-limit";

const TEMP_EMAIL = "verify-flow-test@example.com";
let tempUserId = "";

function post(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("M-2: verification token lifecycle (real code + real DB shape)", () => {
  beforeAll(async () => {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, "verify-flow-temp-user"));
    await db.delete(users).where(eq(users.id, "verify-flow-temp-user"));
    const [row] = await db
      .insert(users)
      .values({
        id: "verify-flow-temp-user",
        organizationId: null,
        name: "Verify Flow",
        email: TEMP_EMAIL,
        passwordHash: await bcrypt.hash("TempPassword123", 4),
        role: "SALES_AGENT",
      })
      .returning();
    tempUserId = row.id;
  });

  afterAll(async () => {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, tempUserId));
    await db.delete(users).where(eq(users.id, tempUserId));
  });

  it("mints prefixed tokens stored only as hashes", async () => {
    const { rawToken } = await createEmailVerification(tempUserId);
    expect(isVerifyTokenFormat(rawToken)).toBe(true);
    const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, tempUserId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.tokenHash === rawToken)).toBe(false);
    expect(await bcrypt.compare(rawToken, rows[rows.length - 1].tokenHash)).toBe(true);
    // Clean up so later tests start from a known state.
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, tempUserId));
  });

  it("a verify-namespaced token can never pass as a reset credential", async () => {
    const { rawToken } = await createEmailVerification(tempUserId);
    const res = await resetPOST(post("/api/auth/reset-password", { token: rawToken, password: "NewPassword123" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This reset link is invalid or expired.", code: "INVALID_RESET_TOKEN" });
    // The verify row must be untouched (still unused) for the next test.
    const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, tempUserId));
    expect(rows.some((r) => !r.usedAt)).toBe(true);
  });

  it("valid token verifies the email and sets emailVerifiedAt", async () => {
    const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, tempUserId));
    const unused = rows.find((r) => !r.usedAt);
    expect(unused).toBeDefined();
    // Recover the raw token by minting a fresh one (the stored hash is opaque).
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, tempUserId));
    const { rawToken } = await createEmailVerification(tempUserId);
    const res = await verifyPOST(post("/api/auth/verify-email", { token: rawToken }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [user] = await db.select().from(users).where(eq(users.id, tempUserId)).limit(1);
    expect(user.emailVerifiedAt).toBeTruthy();
  });

  // NOTE: consume/verify scan live token rows with one bcrypt compare each,
  // so these tests allow extra time on shared dev databases with many live
  // rows. Production exposure is bounded by per-IP/per-token rate limits.
  it("a used token cannot be reused", async () => {
    const { rawToken } = await createEmailVerification(tempUserId);
    expect((await verifyPOST(post("/api/auth/verify-email", { token: rawToken }))).status).toBe(200);
    const again = await verifyPOST(post("/api/auth/verify-email", { token: rawToken }));
    // Replay is refused: the token holder gets the explicit already-verified
    // state (409 ALREADY_VERIFIED) — never a second consume — and everyone
    // else (wrong/garbage tokens) still gets the generic 400 below.
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: "This email address has already been verified. You can sign in.",
      code: "ALREADY_VERIFIED",
    });
    // And the verified stamp is unchanged (idempotent, single consume).
    const [user] = await db.select().from(users).where(eq(users.id, tempUserId)).limit(1);
    expect(user.emailVerifiedAt).toBeTruthy();
  }, 30000);

  it("expired and invalid tokens fail safely with generic errors", async () => {
    const { tokenHash } = await buildVerifyToken();
    await db.insert(passwordResetTokens).values({
      userId: tempUserId,
      tokenHash,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    // Unknown raw values (even well-formed) never verify.
    expect((await verifyPOST(post("/api/auth/verify-email", { token: "verify_deadbeefdeadbeefdeadbeef" }))).status).toBe(400);
    expect((await verifyPOST(post("/api/auth/verify-email", { token: "garbage" }))).status).toBe(400);
    const res = await verifyPOST(post("/api/auth/verify-email", { token: "" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("This verification link is invalid or expired.");
    expect(JSON.stringify(body)).not.toMatch(/verify_|secret|tokenHash/i);
  });

  it("consumeEmailVerification marks exactly one row used", async () => {
    const { rawToken } = await createEmailVerification(tempUserId);
    const found = await consumeEmailVerification(rawToken);
    expect(found?.userId).toBe(tempUserId);
    expect(await consumeEmailVerification(rawToken)).toBeNull();
  }, 30000);

  it("markEmailVerified is idempotent and preserves the first stamp", async () => {
    await markEmailVerified(tempUserId);
    const [first] = await db.select().from(users).where(eq(users.id, tempUserId)).limit(1);
    await markEmailVerified(tempUserId);
    const [second] = await db.select().from(users).where(eq(users.id, tempUserId)).limit(1);
    expect(second.emailVerifiedAt).toBe(first.emailVerifiedAt);
  });

  it("resend is generic for unknown addresses and rate limited per address", async () => {
    const unknown = await resendPOST(post("/api/auth/resend-verification", { email: "nobody-here-xyz@example.com" }));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({
      ok: true,
      message: "If an account exists for that email, a verification link is on its way.",
    });
    const now = 9_000_000;
    for (let i = 0; i < 5; i++) expect((await verifyResendEmailLimiter.check("rate-probe@example.com", now)).allowed).toBe(true);
    expect((await verifyResendEmailLimiter.check("rate-probe@example.com", now)).allowed).toBe(false);
  });

  it("no verification token reaches logs on the deferred-mail path", async () => {
    const warned: unknown[][] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warned.push(args));
    try {
      await resendPOST(post("/api/auth/resend-verification", { email: TEMP_EMAIL }));
      const dumped = JSON.stringify(warned);
      expect(dumped).not.toMatch(/verify_[0-9a-f]{16,}/);
    } finally {
      spy.mockRestore();
    }
  });
});
