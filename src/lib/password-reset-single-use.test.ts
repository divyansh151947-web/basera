import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { passwordResetTokens, users } from "@/db/schema";
import { POST as resetPOST } from "@/app/api/auth/reset-password/route";

/**
 * D-2: a reset token is claimed atomically (conditional `usedAt IS NULL`
 * update) BEFORE the password is mutated, so concurrent submissions of the
 * same link can never both proceed. These tests run against the real
 * database shape (same harness convention as email-verification.test.ts).
 */

const EMAIL = "reset-single-use-test@example.com";
const USER_ID = "reset-single-use-temp-user";
let rawToken = "";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function allUserTokens() {
  return db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, USER_ID));
}

describe("D-2: password reset token is single-use under concurrency", () => {
  beforeAll(async () => {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, USER_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.insert(users).values({
      id: USER_ID,
      organizationId: null,
      name: "Reset Single Use",
      email: EMAIL,
      passwordHash: await bcrypt.hash("OldPassword123", 4),
      role: "SALES_AGENT",
    });
    rawToken = crypto.randomBytes(16).toString("hex");
    await db.insert(passwordResetTokens).values({
      userId: USER_ID,
      tokenHash: await bcrypt.hash(rawToken, 4),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  });

  afterAll(async () => {
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, USER_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
  });

  it("two concurrent submissions of the same token produce exactly one winner", async () => {
    const [first, second] = await Promise.all([
      resetPOST(post({ token: rawToken, password: "BrandNew111" })),
      resetPOST(post({ token: rawToken, password: "SecondNew222" })),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 400]);
    const bodies = [await first.json(), await second.json()];
    const loserIndex = first.status === 400 ? 0 : 1;
    expect(loserIndex === 0 ? first.status : second.status).toBe(400);
    const loser = bodies[loserIndex];
    expect((loser as { code?: string }).code).toBe("INVALID_RESET_TOKEN");
  });

  it("exactly one of the submitted passwords is stored, and the old one is gone", async () => {
    const [user] = await db.select().from(users).where(eq(users.id, USER_ID)).limit(1);
    const stored = user.passwordHash ?? "";
    const firstWins = await bcrypt.compare("BrandNew111", stored);
    const secondWins = await bcrypt.compare("SecondNew222", stored);
    expect(firstWins).not.toBe(secondWins);
    expect(firstWins || secondWins).toBe(true);
    const oldStillWorks = await bcrypt.compare("OldPassword123", stored);
    expect(oldStillWorks).toBe(false);
  });

  it("every sibling row is stamped used so the token cannot be replayed", async () => {
    const rows = await allUserTokens();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.usedAt).toBeTruthy();
    const replay = await resetPOST(post({ token: rawToken, password: "Replay999" }));
    expect(replay.status).toBe(400);
    const replayBody = (await replay.json()) as { code?: string };
    expect(replayBody.code).toBe("INVALID_RESET_TOKEN");
  });
});
