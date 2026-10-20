import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";

vi.mock("server-only", () => ({}));

const sessionState: { current: any } = { current: null };
vi.mock("@/lib/auth", () => ({
  getCurrentSession: () => sessionState.current,
}));

function post(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } as any);
}

function asBuyer(id: string) {
  sessionState.current = { user: { id, role: "BUYER", organizationId: null } };
}

const OLD_PASSWORD = "OldPass123!";
const NEW_PASSWORD = "NewPass456!";
const FINAL_PASSWORD = "FinalPass789!";

/**
 * Change-password regression suite: session-derived identity only, current
 * password verification, policy validation, hash replacement, and the
 * buyer/staff role boundary. Isolated temp DB; real dev.db untouched.
 */
describe("buyer change-password (isolated db)", () => {
  let buyerId: string;
  let staffId: string;
  let route: { POST: (req: NextRequest) => Promise<Response> };
  let testDb: IsolatedTestDb;

  async function hashOf(userId: string) {
    const { db } = await import("@/db/client");
    const { users } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
    return rows[0]?.passwordHash ?? null;
  }

  beforeAll(async () => {
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;

    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: "Chpw Demo", slug: "chpw-demo", isDemo: true })
      .returning();
    const passwordHash = await bcrypt.hash(OLD_PASSWORD, 12);
    const [buyer] = await db
      .insert(schema.users)
      .values({ name: "Chpw Buyer", email: "chpw-buyer@buyers.test", passwordHash, role: "BUYER" })
      .returning();
    const [staff] = await db
      .insert(schema.users)
      .values({
        name: "Chpw Staff",
        email: "chpw-staff@staff.test",
        passwordHash,
        role: "BUSINESS_ADMIN",
        organizationId: org.id,
      })
      .returning();
    buyerId = buyer.id;
    staffId = staff.id;

    route = await import("@/app/api/buyer/change-password/route");
  });

  afterAll(async () => {
    sessionState.current = null;
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  beforeEach(async () => {
    // The route has a genuine 5/15-min per-user abuse cap; clear the bucket
    // so this suite's many synthetic attempts are counted as validation
    // tests, not throttling.
    const { changePasswordUserLimiter } = await import("@/lib/rate-limit");
    await changePasswordUserLimiter.reset(`change-password:user:${buyerId}`).catch(() => undefined);
  });

  it("rejects unauthenticated requests with 401", async () => {
    sessionState.current = null;
    const res = await route.POST(
      post("/api/buyer/change-password", { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmNewPassword: NEW_PASSWORD })
    );
    expect(res.status).toBe(401);
  });

  it("rejects staff sessions with 403 (role boundary)", async () => {
    asBuyer(staffId); // staff identity with the staff role
    sessionState.current = { user: { id: staffId, role: "BUSINESS_ADMIN", organizationId: "x" } };
    const res = await route.POST(
      post("/api/buyer/change-password", { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmNewPassword: NEW_PASSWORD })
    );
    expect(res.status).toBe(403);
    // Staff hash untouched.
    expect(await hashOf(staffId)).not.toBeNull();
  });

  it("rejects empty fields with 400", async () => {
    asBuyer(buyerId);
    const res = await route.POST(post("/api/buyer/change-password", { currentPassword: "", newPassword: "", confirmNewPassword: "" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeTruthy();
  });

  it("rejects mismatched new-password confirmation with 400", async () => {
    asBuyer(buyerId);
    const res = await route.POST(
      post("/api/buyer/change-password", { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD, confirmNewPassword: "Different999!" })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a weak new password with 400", async () => {
    asBuyer(buyerId);
    const res = await route.POST(
      post("/api/buyer/change-password", { currentPassword: OLD_PASSWORD, newPassword: "short", confirmNewPassword: "short" })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a new password equal to the current one with 400", async () => {
    asBuyer(buyerId);
    const res = await route.POST(
      post("/api/buyer/change-password", { currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD, confirmNewPassword: OLD_PASSWORD })
    );
    expect(res.status).toBe(400);
  });

  it("rejects an incorrect current password with 400 and leaves the hash unchanged", async () => {
    asBuyer(buyerId);
    const before = await hashOf(buyerId);
    const res = await route.POST(
      post("/api/buyer/change-password", { currentPassword: "WrongPass999!", newPassword: NEW_PASSWORD, confirmNewPassword: NEW_PASSWORD })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("CURRENT_PASSWORD_INVALID");
    expect(await hashOf(buyerId)).toBe(before);
  });

  it("never lets a buyer change another account's password (identity is session-derived)", async () => {
    asBuyer(buyerId);
    const staffHashBefore = await hashOf(staffId);
    // Even a well-formed payload only ever targets the session user. This
    // attempt SUCCEEDS for the buyer's own account (rotating it to
    // NEW_PASSWORD) while leaving the staff account untouched.
    const res = await route.POST(
      post("/api/buyer/change-password", {
        currentPassword: OLD_PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmNewPassword: NEW_PASSWORD,
        userId: staffId, // ignored: client-supplied ids are never trusted
        id: staffId,
      })
    );
    expect(res.status).toBe(200);
    expect(await hashOf(staffId)).toBe(staffHashBefore);
    // Buyer's own hash DID rotate.
    expect(await bcrypt.compare(NEW_PASSWORD, (await hashOf(buyerId))!)).toBe(true);
  });

  it("a second successful change stores a fresh bcrypt hash that authenticates the new password and rejects the old one", async () => {
    asBuyer(buyerId);
    const res = await route.POST(
      post("/api/buyer/change-password", { currentPassword: NEW_PASSWORD, newPassword: FINAL_PASSWORD, confirmNewPassword: FINAL_PASSWORD })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.reauthRequired).toBe(true);

    const stored = (await hashOf(buyerId))!;
    // The response must never leak the passwords or the hash.
    const raw = JSON.stringify(data);
    expect(raw).not.toContain(FINAL_PASSWORD);
    expect(raw).not.toContain(stored);

    expect(await bcrypt.compare(FINAL_PASSWORD, stored)).toBe(true);
    expect(await bcrypt.compare(NEW_PASSWORD, stored)).toBe(false);
    expect(await bcrypt.compare(OLD_PASSWORD, stored)).toBe(false);
  });

  it("the new password can authenticate again (old password no longer can)", async () => {
    // The full login path is bcrypt.compare(password, storedHash) — as in
    // auth.ts authorize(). After the change above, only the FINAL password
    // passes that check.
    const stored = (await hashOf(buyerId))!;
    expect(await bcrypt.compare(FINAL_PASSWORD, stored)).toBe(true);
    expect(await bcrypt.compare(NEW_PASSWORD, stored)).toBe(false);
    expect(await bcrypt.compare(OLD_PASSWORD, stored)).toBe(false);
  });
});
