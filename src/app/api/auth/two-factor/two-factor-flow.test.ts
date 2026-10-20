import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";

vi.mock("server-only", () => ({}));

// Session is mocked (like buyer-ownership.test.ts) while the REAL
// `authOptions.authorize` is exercised — the 2FA gate must be tested for
// real, not against a stand-in.
const sessionState: { current: any } = { current: null };
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getCurrentSession: () => sessionState.current };
});

function req(url: string, init?: { method?: string; body?: unknown; ip?: string }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init?.ip ? { "x-forwarded-for": init.ip } : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  } as any);
}

/**
 * End-to-end (in-process) coverage of the real TOTP two-factor flow:
 * setup → enable (verified enrollment) → login challenge → verify →
 * single-use consumption inside `authorize` → disable.
 *
 * Runs against an isolated temp SQLite DB with real migrations; the real
 * dev.db and any production data are never touched. No bypass exists in
 * production code — codes are computed with the same `totpAt` an
 * authenticator app would use.
 */
describe("two-factor flow (isolated db)", () => {
  let testDb: IsolatedTestDb;
  let routes: Record<string, any>;
  let authorize: (credentials: any, req?: any) => Promise<any>;
  let userId: string;
  let otherUserId: string;
  let secret: string;
  let challengeId: string;
  let recoveryCodes: string[];
  let totp: (atMs?: number) => string;
  const password = "Str0ngPass!xyz";

  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "e2e-two-factor-test-secret-value";
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;

    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const hash = await bcrypt.hash(password, 4);
    const [user] = await db
      .insert(schema.users)
      .values({ name: "2FA Buyer", email: "2fa@buyers.test", passwordHash: hash, role: "BUYER" })
      .returning();
    const [other] = await db
      .insert(schema.users)
      .values({ name: "Other Buyer", email: "other2fa@buyers.test", passwordHash: hash, role: "BUYER" })
      .returning();
    userId = user.id;
    otherUserId = other.id;

    routes = {
      setup: await import("@/app/api/auth/two-factor/setup/route"),
      enable: await import("@/app/api/auth/two-factor/enable/route"),
      challenge: await import("@/app/api/auth/two-factor/challenge/route"),
      verify: await import("@/app/api/auth/two-factor/verify/route"),
      disable: await import("@/app/api/auth/two-factor/disable/route"),
    };

    const { authOptions } = await import("@/lib/auth");
    // CredentialsProvider wraps the user config under `.options`; the
    // top-level `authorize` is next-auth's default `() => null`.
    const provider: any = authOptions.providers[0];
    authorize = (credentials: any) => provider.options.authorize(credentials, {});
    const totpModule = await import("@/lib/two-factor");
    totp = (atMs?: number) => totpModule.totpAt(secret, atMs);
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  function asUser(id: string) {
    sessionState.current = { user: { id, role: "BUYER", organizationId: null } };
  }
  function asAnonymous() {
    sessionState.current = null;
  }

  it("rejects unauthenticated setup/enable/disable", async () => {
    asAnonymous();
    expect((await routes.setup.POST(req("/x"))).status).toBe(401);
    expect((await routes.enable.POST(req("/x", { body: { code: "123456" } }))).status).toBe(401);
    expect((await routes.disable.POST(req("/x", { body: { code: "123456" } }))).status).toBe(401);
  });

  it("setup returns a QR + manual key but does NOT enable 2FA", async () => {
    asUser(userId);
    const before = await (await routes.setup.GET(req("/x", { method: "GET" }))).json();
    expect(before).toMatchObject({ enabled: false, pending: false });

    const res = await routes.setup.POST(req("/x"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(data.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(data.otpauthUri).toContain("otpauth://totp/");
    expect(data.digits).toBe(6);
    expect(data.period).toBe(30);

    secret = data.secret;

    // Pending only: a half-finished setup can never gate a login.
    const after = await (await routes.setup.GET(req("/x", { method: "GET" }))).json();
    expect(after).toMatchObject({ enabled: false, pending: true });
  });

  it("enable refuses wrong codes and only enables after a valid TOTP", async () => {
    asUser(userId);
    const wrong = await routes.enable.POST(req("/x", { body: { code: "000000" } }));
    // Guard against the (astronomically unlikely) real code being 000000.
    expect(wrong.status).toBe(totp() === "000000" ? 200 : 401);

    if (wrong.status === 401) {
      const status = await (await routes.setup.GET(req("/x", { method: "GET" }))).json();
      expect(status).toMatchObject({ enabled: false, pending: true });
    }

    const ok = await routes.enable.POST(req("/x", { body: { code: totp() } }));
    expect(ok.status).toBe(200);
    const data = await ok.json();
    recoveryCodes = data.recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);

    const status = await (await routes.setup.GET(req("/x", { method: "GET" }))).json();
    expect(status).toMatchObject({ enabled: true, pending: false });

    const remaining = await (await routes.enable.GET()).json();
    expect(remaining.remaining).toBe(10);

    // Re-running setup on an enabled account is refused (no silent re-enroll).
    expect((await routes.setup.POST(req("/x"))).status).toBe(409);
    // Enabling again is refused too.
    expect((await routes.enable.POST(req("/x", { body: { code: totp() } }))).status).toBe(409);
  });

  it("login challenge is minted only with the right password", async () => {
    asAnonymous();
    expect((await routes.challenge.POST(req("/x", { body: { email: "2fa@buyers.test", password: "nope" } }))).status).toBe(401);

    const res = await routes.challenge.POST(req("/x", { body: { email: "2fa@buyers.test", password } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.required).toBe(true);
    expect(data.challengeId).toBeTruthy();
    expect(Date.parse(data.expiresAt)).toBeGreaterThan(Date.now());
    challengeId = data.challengeId;

    // An account WITHOUT 2FA must not be challenged (plain sign-in path).
    const other = await routes.challenge.POST(req("/x", { body: { email: "other2fa@buyers.test", password } }));
    expect(other.status).toBe(200);
    expect((await other.json()).required).toBe(false);
  });

  it("verify marks the challenge only for a valid code", async () => {
    asAnonymous();
    const bad = await routes.verify.POST(req("/x", { body: { challengeId, code: "999999" } }));
    expect(bad.status).toBe(totp() === "999999" ? 200 : 401);

    const good = await routes.verify.POST(req("/x", { body: { challengeId, code: totp() } }));
    expect(good.status).toBe(200);
    expect((await good.json()).ok).toBe(true);
  });

  it("authorize requires a verified, fresh, single-use challenge when 2FA is on", async () => {
    // No challenge at all → sign-in is refused outright.
    await expect(
      authorize({ email: "2fa@buyers.test", password })
    ).rejects.toThrow("TWO_FACTOR_REQUIRED");

    // A challenge that was never verified → refused.
    const freshRes = await routes.challenge.POST(req("/x", { body: { email: "2fa@buyers.test", password } }));
    const freshId = (await freshRes.json()).challengeId as string;
    await expect(
      authorize({ email: "2fa@buyers.test", password, twoFactorChallengeId: freshId })
    ).rejects.toThrow("TWO_FACTOR_REQUIRED");

    // Someone else's challenge cannot be replayed against this account.
    const otherRes = await routes.challenge.POST(req("/x", { body: { email: "other2fa@buyers.test", password } }));
    const otherChallenge = (await otherRes.json()).challengeId as string;
    await expect(
      authorize({ email: "2fa@buyers.test", password, twoFactorChallengeId: otherChallenge })
    ).rejects.toThrow("TWO_FACTOR_REQUIRED");

    // Verified challenge → sign-in succeeds exactly once...
    const user = await authorize({
      email: "2fa@buyers.test",
      password,
      twoFactorChallengeId: challengeId,
    });
    expect(user).toBeTruthy();
    expect(user.id).toBe(userId);
    expect(user.passwordVersion).toBeTruthy();

    // ...and the same challenge cannot mint a second session.
    await expect(
      authorize({ email: "2fa@buyers.test", password, twoFactorChallengeId: challengeId })
    ).rejects.toThrow("TWO_FACTOR_REQUIRED");
  });

  it("wrong password still fails after a verified challenge", async () => {
    const res = await routes.challenge.POST(req("/x", { body: { email: "2fa@buyers.test", password } }));
    const id = (await res.json()).challengeId as string;
    const verify = await routes.verify.POST(req("/x", { body: { challengeId: id, code: totp() } }));
    expect(verify.status).toBe(200);

    // Wrong password never yields a session (returns null, not a user).
    const user = await authorize({
      email: "2fa@buyers.test",
      password: "totally-wrong",
      twoFactorChallengeId: id,
    });
    expect(user).toBeNull();
  });

  it("an account without 2FA signs in normally (no challenge required)", async () => {
    const user = await authorize({ email: "other2fa@buyers.test", password });
    expect(user).toBeTruthy();
    expect(user.id).toBe(otherUserId);
  });

  it("recovery codes work once at login, then are spent", async () => {
    asAnonymous();
    const res = await routes.challenge.POST(req("/x", { body: { email: "2fa@buyers.test", password } }));
    const id = (await res.json()).challengeId as string;

    const code = recoveryCodes[0];
    const verify = await routes.verify.POST(req("/x", { body: { challengeId: id, code } }));
    expect(verify.status).toBe(200);

    const user = await authorize({ email: "2fa@buyers.test", password, twoFactorChallengeId: id });
    expect(user).toBeTruthy();

    // Spending the same recovery code again must fail.
    const res2 = await routes.challenge.POST(req("/x", { body: { email: "2fa@buyers.test", password } }));
    const id2 = (await res2.json()).challengeId as string;
    const replay = await routes.verify.POST(req("/x", { body: { challengeId: id2, code } }));
    expect(replay.status).toBe(401);

    asUser(userId);
    const remaining = await (await routes.enable.GET()).json();
    expect(remaining.remaining).toBe(9);
  });
  it("disable requires a valid code for the signed-in user and tears everything down", async () => {
    asUser(userId);
    const bad = await routes.disable.POST(req("/x", { body: { code: "000000" } }));
    expect(bad.status).toBe(totp() === "000000" ? 200 : 401);

    if ((await (await routes.setup.GET(req("/x", { method: "GET" }))).json()).enabled) {
      const ok = await routes.disable.POST(req("/x", { body: { code: totp() } }));
      expect(ok.status).toBe(200);
      expect((await ok.json()).ok).toBe(true);
    }

    const status = await (await routes.setup.GET(req("/x", { method: "GET" }))).json();
    expect(status).toMatchObject({ enabled: false, pending: false });

    const remaining = await (await routes.enable.GET()).json();
    expect(remaining.remaining).toBe(0);

    // With 2FA off, sign-in no longer demands a challenge.
    const challenge = await routes.challenge.POST(
      req("/x", { body: { email: "2fa@buyers.test", password } })
    );
    expect((await challenge.json()).required).toBe(false);
    const user = await authorize({ email: "2fa@buyers.test", password });
    expect(user).toBeTruthy();
  });
});
