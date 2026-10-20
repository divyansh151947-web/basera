import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";

vi.mock("server-only", () => ({}));

/**
 * REGRESSION: "Unable to sign in right now. Please try again." on
 * /buyer/login (and /login).
 *
 * Root cause (browser-reproduced): the repository's dev.db predated the
 * `0007_two_factor` migration, so the `two_factor_*` tables did not exist.
 * Every sign-in now calls `isTwoFactorEnabled` twice — inside
 * POST /api/auth/two-factor/challenge and again inside `authorize` — where
 * it raised `SqliteError: no such table: two_factor_credentials`. The
 * challenge route caught it and answered 500, and the client maps any
 * non-401/403/429 to the generic message. A valid password therefore failed
 * while an invalid one still got a correct 401, which is what made this look
 * like a credentials problem.
 *
 * This suite reproduces that exact condition (isolated temp DB, then the
 * three 2FA tables dropped — the E2E seed always runs migrations, which is
 * why the browser suite never caught it) and pins the behaviour:
 *   1. sign-in works with the schema pending,
 *   2. wrong password / unknown buyer still fail,
 *   3. the detector is precise about WHICH table is missing,
 *   4. the controlled EMAIL_NOT_VERIFIED signal still passes through,
 *   5. an unexpected database failure can no longer reach the browser.
 *
 * No security is relaxed: password verification, the email-ownership gate
 * and 2FA enforcement (covered by two-factor-flow.test.ts, which runs with
 * the tables present) are all unchanged.
 */
describe("sign-in when the two-factor schema has not been migrated", () => {
  let testDb: IsolatedTestDb;
  let challengeRoute: { POST: (req: NextRequest) => Promise<Response> };
  let authorize: (credentials: any, req?: any) => Promise<any>;
  let unverifiedUserId: string;
  const password = "Str0ngPass!xyz";

  function post(url: string, body: unknown) {
    return new NextRequest(`http://localhost${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify(body),
    } as any);
  }

  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "schema-drift-test-secret-value";
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;

    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const hash = await bcrypt.hash(password, 4);

    // Buyer shaped like the ones already living in a pre-2FA database:
    // no organization and an unverified address, neither of which blocks
    // sign-in (see shouldBlockUnverifiedLogin).
    await db
      .insert(schema.users)
      .values({ name: "Drift Buyer", email: "buyer@drift.test", passwordHash: hash, role: "BUYER" });

    // Buyer inside a NON-demo organization with an unverified address — the
    // one shape that must keep surfacing the controlled EMAIL_NOT_VERIFIED
    // signal through the new error guard.
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: "Drift Realty", slug: "drift-realty", isDemo: false })
      .returning();
    const [unverified] = await db
      .insert(schema.users)
      .values({
        name: "Unverified Buyer",
        email: "unverified@drift.test",
        passwordHash: hash,
        role: "BUYER",
        organizationId: org.id,
      })
      .returning();
    unverifiedUserId = unverified.id;

    // ===== THE DEFECT, reproduced =====
    // A database that has never run 0007_two_factor.
    await db.run(sql`DROP TABLE two_factor_credentials`);
    await db.run(sql`DROP TABLE two_factor_challenges`);
    await db.run(sql`DROP TABLE two_factor_recovery_codes`);

    challengeRoute = await import("@/app/api/auth/two-factor/challenge/route");

    const { authOptions } = await import("@/lib/auth");
    // next-auth wraps the provider config under `.options`; the top-level
    // `authorize` is next-auth's default `() => null`.
    const provider: any = authOptions.providers[0];
    authorize = (credentials: any) => provider.options.authorize(credentials, {});
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  it("a valid buyer signs in (the exact reported failure now passes)", async () => {
    const res = await challengeRoute.POST(post("/api/auth/two-factor/challenge", { email: "buyer@drift.test", password }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ required: false });

    const user = await authorize({ email: "buyer@drift.test", password });
    expect(user).toBeTruthy();
    expect(user.email).toBe("buyer@drift.test");
    expect(user.role).toBe("BUYER");
    // M-1 session binding must survive the fix: the session still carries the
    // current password hash so later password changes orphan old sessions.
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const rows = await db
      .select({ hash: schema.users.passwordHash })
      .from(schema.users)
      .where(sql`email = 'buyer@drift.test'`)
      .limit(1);
    expect(user.passwordVersion).toBe(rows[0].hash);
  });

  it("an incorrect password still fails with the same generic 401", async () => {
    const res = await challengeRoute.POST(
      post("/api/auth/two-factor/challenge", { email: "buyer@drift.test", password: "WrongPassword1!" })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid email or password." });

    await expect(authorize({ email: "buyer@drift.test", password: "WrongPassword1!" })).resolves.toBeNull();
  });

  it("a nonexistent buyer still fails (no account-existence signal)", async () => {
    const res = await challengeRoute.POST(
      post("/api/auth/two-factor/challenge", { email: "nobody@drift.test", password: "Whatever123!" })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid email or password." });

    await expect(authorize({ email: "nobody@drift.test", password: "Whatever123!" })).resolves.toBeNull();
  });

  it("malformed payloads are still rejected before any lookup", async () => {
    const res = await challengeRoute.POST(post("/api/auth/two-factor/challenge", { email: "", password: "" }));
    expect(res.status).toBe(400);
  });

  it("the 2FA check reports 'off' instead of throwing, and only for ITS tables", async () => {
    const { isTwoFactorEnabled, isMissingTwoFactorSchemaError } = await import("@/lib/data/two-factor");

    // Root-cause guard: with no table there are zero enrollments, so this is
    // a fact, not a bypass — and password verification still runs.
    await expect(isTwoFactorEnabled(unverifiedUserId)).resolves.toBe(false);

    // The detector must be surgical: a missing table from ANY other feature,
    // or a genuine outage, is not this condition and has to keep propagating
    // so a real failure still fails closed.
    const sqlite = (message: string) => Object.assign(new Error(message), { code: "SQLITE_ERROR" });
    expect(isMissingTwoFactorSchemaError(sqlite("no such table: two_factor_credentials"))).toBe(true);
    expect(isMissingTwoFactorSchemaError(sqlite("no such table: two_factor_challenges"))).toBe(true);
    expect(isMissingTwoFactorSchemaError(sqlite("no such table: organizations"))).toBe(false);
    expect(isMissingTwoFactorSchemaError(sqlite("no such table: users"))).toBe(false);
    expect(isMissingTwoFactorSchemaError(Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }))).toBe(false);
    expect(isMissingTwoFactorSchemaError(Object.assign(new Error('relation "two_factor_credentials" does not exist'), { code: "42P01" }))).toBe(true);
    expect(isMissingTwoFactorSchemaError(Object.assign(new Error('relation "users" does not exist'), { code: "42P01" }))).toBe(false);
    expect(isMissingTwoFactorSchemaError(new Error("ECONNREFUSED 127.0.0.1:5432"))).toBe(false);
    expect(isMissingTwoFactorSchemaError(null)).toBe(false);
    expect(isMissingTwoFactorSchemaError("no such table: two_factor_credentials")).toBe(false);
  });

  it("the controlled EMAIL_NOT_VERIFIED signal still passes through the guard", async () => {
    await expect(authorize({ email: "unverified@drift.test", password })).rejects.toThrow("EMAIL_NOT_VERIFIED");
  });

  it("an unexpected database failure never reaches the browser, but is logged", async () => {
    // Break the lookup that runs AFTER the password has already checked out,
    // so this is the realistic "database failed mid-login" case.
    const { db } = await import("@/db/client");
    await db.run(sql`ALTER TABLE organizations RENAME TO organizations_gone`);

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let thrown: any;
    let logged = "";
    try {
      await authorize({ email: "unverified@drift.test", password });
    } catch (error) {
      thrown = error;
    } finally {
      // Read BEFORE mockRestore(): vitest's mockRestore clears call history.
      logged = JSON.stringify(spy.mock.calls);
      spy.mockRestore();
    }

    // The redirect next-auth builds is `?error=<error.message>` and
    // signIn() hands it back as `res.error`, so the message IS the channel
    // to the browser. It must carry nothing internal.
    expect(thrown).toBeTruthy();
    expect(thrown.message).toBe("SERVICE_UNAVAILABLE");
    expect(thrown.message).not.toMatch(/no such table|SqliteError|organizations/i);

    // ...while the actionable detail stays server-side, and no credential
    // material is ever part of it.
    expect(logged).toContain("[auth] credentials authorize failed unexpectedly:");
    expect(logged).toContain("no such table: organizations");
    expect(logged).not.toContain(password);
  });
});
