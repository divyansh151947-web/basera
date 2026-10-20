import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";

vi.mock("server-only", () => ({}));

const sessionState: { current: any } = { current: null };
vi.mock("@/lib/auth", () => ({
  getCurrentSession: () => sessionState.current,
}));

function req(url: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  } as any);
}

function asBuyer(id: string) {
  sessionState.current = { user: { id, role: "BUYER", organizationId: null } };
}
function asStaff(id: string, organizationId: string, role = "BUSINESS_ADMIN") {
  sessionState.current = { user: { id, role, organizationId } };
}
function asAnonymous() {
  sessionState.current = null;
}

/**
 * Buyer comparison hardening (Priority 2A): every entry point validates
 * shape + buyer visibility server-side. Synthetic orgs/buyers/properties
 * only; isolated temp DB with owned-cleanup teardown.
 */
describe("buyer comparison hardening (isolated db)", () => {
  let ids: Record<string, string>;
  let routes: Record<string, any>;
  let testDb: IsolatedTestDb;

  beforeAll(async () => {
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;

    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const mkOrg = async (name: string, slug: string, isDemo: boolean) =>
      (await db.insert(schema.organizations).values({ name, slug, isDemo }).returning())[0];
    const org = await mkOrg("Marketplace Demo", "basera", true);
    const otherOrg = await mkOrg("Private Brokerage", "private-brokerage", false);
    const mkProp = async (organizationId: string, projectName: string, extra: Record<string, unknown> = {}) =>
      (
        await db
          .insert(schema.properties)
          .values({
            organizationId,
            projectName,
            propertyType: "APARTMENT",
            city: "Jaipur",
            locality: "Test Area",
            priceMinInr: 5000000,
            priceMaxInr: 7000000,
            availability: "AVAILABLE",
            ...extra,
          })
          .returning()
      )[0];
    const propA = await mkProp(org.id, "Compare A");
    const propB = await mkProp(org.id, "Compare B");
    const foreignProp = await mkProp(otherOrg.id, "Foreign Villa");
    const archivedProp = await mkProp(org.id, "Archived Flat", { isArchived: true } as any);
    const soldProp = await mkProp(org.id, "Sold Flat", { availability: "SOLD_OUT" });
    const mkBuyer = async (name: string, email: string) =>
      (await db.insert(schema.users).values({ name, email, passwordHash: "hash", role: "BUYER" }).returning())[0];
    const buyerA = await mkBuyer("Cmp A", "cmp-a@buyers.test");
    const buyerB = await mkBuyer("Cmp B", "cmp-b@buyers.test");
    const [staff] = await db
      .insert(schema.users)
      .values({ organizationId: org.id, name: "Cmp Staff", email: "cmp-staff@test.com", passwordHash: "hash", role: "MANAGER" })
      .returning();
    ids = {
      org: org.id,
      propA: propA.id,
      propB: propB.id,
      foreign: foreignProp.id,
      archived: archivedProp.id,
      sold: soldProp.id,
      buyerA: buyerA.id,
      buyerB: buyerB.id,
      staff: staff.id,
    };

    routes = {
      comparisons: await import("@/app/api/buyer/comparisons/route"),
      comparisonById: await import("@/app/api/buyer/comparisons/[id]/route"),
    };
  });

  afterAll(async () => {
    // Release the better-sqlite3 handle first: Windows cannot remove an
    // open database file, so close before deleting the owned directory.
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  const post = (body: unknown) =>
    routes.comparisons.POST(req("/api/buyer/comparisons", { method: "POST", body }));

  it("rejects unauthenticated and non-buyer callers", async () => {
    asAnonymous();
    expect((await post({ propertyIds: [ids.propA, ids.propB] })).status).toBe(401);
    asStaff(ids.staff, ids.org);
    expect((await post({ propertyIds: [ids.propA, ids.propB] })).status).toBe(403);
    expect(
      (await routes.comparisonById.GET(req("/x"), { params: Promise.resolve({ id: "anything" }) })).status
    ).toBe(403);
  });

  it("accepts a valid two-property comparison and resolves both", async () => {
    asBuyer(ids.buyerA);
    const res = await post({ name: "A vs B", propertyIds: [ids.propA, ids.propB] });
    expect(res.status).toBe(201);
    const created = (await res.json()).comparison;
    const fetched = await (
      await routes.comparisonById.GET(req(`/x`), { params: Promise.resolve({ id: created.id }) })
    ).json();
    expect(fetched.properties).toHaveLength(2);
    expect((await routes.comparisonById.DELETE(req("/x", { method: "DELETE" }), { params: Promise.resolve({ id: created.id }) })).status).toBe(200);
  });

  it("rejects malformed, missing, duplicate, and oversized ID lists with 400", async () => {
    asBuyer(ids.buyerA);
    const cases: Array<[string, unknown]> = [
      ["missing", {}],
      ["non-array", { propertyIds: "nope" }],
      ["single", { propertyIds: [ids.propA] }],
      ["empty", { propertyIds: [] }],
      ["six", { propertyIds: [ids.propA, ids.propB, "x1", "x2", "x3", "x4"] }],
      ["hundred", { propertyIds: Array.from({ length: 100 }, (_, i) => `p-${i}`) }],
      ["non-string member", { propertyIds: [ids.propA, 123] }],
      ["null member", { propertyIds: [ids.propA, null] }],
      ["empty-string member", { propertyIds: [ids.propA, ""] }],
      ["oversized member", { propertyIds: [ids.propA, "x".repeat(129)] }],
      ["duplicates", { propertyIds: [ids.propA, ids.propA] }],
    ];
    for (const [label, body] of cases) {
      expect(await (await post(body)).status, label).toBe(400);
    }
  });

  it("rejects bad names and ignores smuggled identity fields", async () => {
    asBuyer(ids.buyerA);
    expect((await post({ name: 12345, propertyIds: [ids.propA, ids.propB] })).status).toBe(400);
    expect((await post({ name: "x".repeat(121), propertyIds: [ids.propA, ids.propB] })).status).toBe(400);
    const res = await post({
      propertyIds: [ids.propA, ids.propB],
      userId: ids.buyerB,
      organizationId: ids.org,
      role: "SUPER_ADMIN",
    });
    expect(res.status).toBe(201);
    const created = (await res.json()).comparison;
    // Smuggled identity is ignored: the row belongs to the session buyer.
    asBuyer(ids.buyerB);
    expect((await routes.comparisonById.GET(req("/x"), { params: Promise.resolve({ id: created.id }) })).status).toBe(404);
    asBuyer(ids.buyerA);
    expect((await routes.comparisonById.DELETE(req("/x", { method: "DELETE" }), { params: Promise.resolve({ id: created.id }) })).status).toBe(200);
  });

  it("rejects unknown, foreign-org, archived, and unavailable properties with 404", async () => {
    asBuyer(ids.buyerA);
    for (const [label, bad] of [
      ["ghost", "ghost-id"],
      ["foreign-org", ids.foreign],
      ["archived", ids.archived],
      ["sold", ids.sold],
    ] as Array<[string, string]>) {
      const res = await post({ propertyIds: [ids.propA, bad] });
      expect(res.status, label).toBe(404);
    }
  });

  it("PATCH validates, allows name-only updates, and rejects empty updates", async () => {
    asBuyer(ids.buyerA);
    const created = (await (await post({ propertyIds: [ids.propA, ids.propB] })).json()).comparison;
    const patch = (body: unknown) =>
      routes.comparisonById.PATCH(req("/x", { method: "PATCH", body }), { params: Promise.resolve({ id: created.id }) });
    expect((await patch({})).status).toBe(400);
    expect((await patch({ propertyIds: [ids.propA] })).status).toBe(400);
    expect((await patch({ propertyIds: [ids.propA, "ghost"] })).status).toBe(404);
    expect((await patch({ propertyIds: [ids.propA, ids.propA] })).status).toBe(400);
    expect((await patch({ name: 999 })).status).toBe(400);
    const ok = await patch({ name: "Renamed" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).comparison.name).toBe("Renamed");
    const ok2 = await patch({ propertyIds: [ids.propB, ids.propA] });
    expect(ok2.status).toBe(200);
    expect((await routes.comparisonById.DELETE(req("/x", { method: "DELETE" }), { params: Promise.resolve({ id: created.id }) })).status).toBe(200);
  });

  it("cross-buyer access stays invisible (404) and repeated add/remove works", async () => {
    asBuyer(ids.buyerA);
    const first = (await (await post({ propertyIds: [ids.propA, ids.propB] })).json()).comparison;
    asBuyer(ids.buyerB);
    expect((await routes.comparisonById.GET(req("/x"), { params: Promise.resolve({ id: first.id }) })).status).toBe(404);
    expect((await routes.comparisonById.PATCH(req("/x", { method: "PATCH", body: { name: "hijack" } }), { params: Promise.resolve({ id: first.id }) })).status).toBe(404);
    expect((await routes.comparisonById.DELETE(req("/x", { method: "DELETE" }), { params: Promise.resolve({ id: first.id }) })).status).toBe(404);
    asBuyer(ids.buyerA);
    expect((await routes.comparisonById.DELETE(req("/x", { method: "DELETE" }), { params: Promise.resolve({ id: first.id }) })).status).toBe(200);
    // Re-adding the same pair after removal works (no stale uniqueness).
    const second = await post({ propertyIds: [ids.propA, ids.propB] });
    expect(second.status).toBe(201);
  });
});
