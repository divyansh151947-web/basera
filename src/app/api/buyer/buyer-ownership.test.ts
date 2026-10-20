import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";

vi.mock("server-only", () => ({}));

// Authenticated identity is the mocked server session — never request data.
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
 * Buyer data-ownership regression tests (Step 2, Phase C).
 *
 * Runs against an isolated temp SQLite database (real migrations applied),
 * so the real dev.db is never touched. Every cross-account case uses two
 * distinct buyer sessions to prove userId substitution is impossible.
 */
describe("buyer data ownership (isolated db)", () => {
  let ids: Record<string, string>;
  let routes: Record<string, any>;
  let testDb: IsolatedTestDb;

  beforeAll(async () => {
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;

    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: "Public Demo", slug: "basera", isDemo: true })
      .returning();
    const [prop] = await db
      .insert(schema.properties)
      .values({
        organizationId: org.id,
        projectName: "Test Heights",
        propertyType: "APARTMENT",
        city: "Jaipur",
        locality: "Malviya Nagar",
        priceMinInr: 5000000,
        priceMaxInr: 7000000,
        availability: "AVAILABLE",
      })
      .returning();
    const [prop2] = await db
      .insert(schema.properties)
      .values({
        organizationId: org.id,
        projectName: "Second Towers",
        propertyType: "APARTMENT",
        city: "Jaipur",
        locality: "Tonk Road",
        priceMinInr: 6000000,
        priceMaxInr: 8000000,
        availability: "AVAILABLE",
      })
      .returning();
    const mkBuyer = async (name: string, email: string) =>
      (
        await db
          .insert(schema.users)
          .values({ name, email, passwordHash: "hash", role: "BUYER" })
          .returning()
      )[0];
    const buyerA = await mkBuyer("Buyer A", "a@buyers.test");
    const buyerB = await mkBuyer("Buyer B", "b@buyers.test");
    const [staff] = await db
      .insert(schema.users)
      .values({ organizationId: org.id, name: "Staff", email: "s@staff.test", passwordHash: "hash", role: "MANAGER" })
      .returning();
    ids = { org: org.id, prop: prop.id, prop2: prop2.id, buyerA: buyerA.id, buyerB: buyerB.id, staff: staff.id };

    routes = {
      prefs: await import("@/app/api/buyer/preferences/route"),
      saved: await import("@/app/api/buyer/saved/route"),
      visits: await import("@/app/api/buyer/visits/route"),
      visitById: await import("@/app/api/buyer/visits/[id]/route"),
      comparisons: await import("@/app/api/buyer/comparisons/route"),
      comparisonById: await import("@/app/api/buyer/comparisons/[id]/route"),
      recent: await import("@/app/api/buyer/recently-viewed/route"),
      profile: await import("@/app/api/buyer/profile/route"),
    };
  });

  afterAll(async () => {
    // Release the better-sqlite3 handle first: Windows cannot remove an
    // open database file, so close before deleting the owned directory.
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  it("unauthenticated and staff callers are rejected on buyer APIs", async () => {
    asAnonymous();
    expect((await routes.prefs.GET(req("/api/buyer/preferences"))).status).toBe(401);
    expect((await routes.saved.GET(req("/api/buyer/saved"))).status).toBe(401);
    asStaff(ids.staff, ids.org);
    expect((await routes.prefs.GET(req("/api/buyer/preferences"))).status).toBe(403);
    expect((await routes.saved.GET(req("/api/buyer/saved"))).status).toBe(403);
    expect((await routes.profile.GET(req("/api/buyer/profile"))).status).toBe(403);
  });

  it("preferences persist per buyer and are invisible across accounts", async () => {
    asBuyer(ids.buyerA);
    expect(await (await routes.prefs.PATCH(req("/api/buyer/preferences", { method: "PATCH", body: { budgetMaxInr: 8000000, purpose: "BUY" } }))).json()).toMatchObject({ ok: true });
    expect(await (await routes.prefs.GET(req("/api/buyer/preferences"))).json()).toMatchObject({
      preferences: { budgetMaxInr: 8000000, purpose: "BUY" },
    });
    asBuyer(ids.buyerB);
    expect(await (await routes.prefs.GET(req("/api/buyer/preferences"))).json()).toEqual({ preferences: null });
    // B writing prefs must not clobber A's.
    await routes.prefs.PATCH(req("/api/buyer/preferences", { method: "PATCH", body: { preferredCity: "Jaipur" } }));
    asBuyer(ids.buyerA);
    expect(await (await routes.prefs.GET(req("/api/buyer/preferences"))).json()).toMatchObject({
      preferences: { budgetMaxInr: 8000000, preferredCity: null },
    });
  });

  it("saved properties: duplicates rejected, invalid ids 404, deletes are scoped", async () => {
    asBuyer(ids.buyerA);
    expect((await routes.saved.POST(req("/api/buyer/saved", { method: "POST", body: { propertyId: ids.prop } }))).status).toBe(200);
    expect((await routes.saved.POST(req("/api/buyer/saved", { method: "POST", body: { propertyId: ids.prop } }))).status).toBe(409);
    expect((await routes.saved.POST(req("/api/buyer/saved", { method: "POST", body: { propertyId: "ghost" } }))).status).toBe(404);
    // Another buyer sees none of A's saves and cannot remove them.
    asBuyer(ids.buyerB);
    expect((await (await routes.saved.GET(req("/api/buyer/saved"))).json()).properties).toEqual([]);
    expect((await routes.saved.DELETE(req(`/api/buyer/saved?propertyId=${ids.prop}`, { method: "DELETE" }))).status).toBe(200);
    asBuyer(ids.buyerA);
    expect((await (await routes.saved.GET(req("/api/buyer/saved"))).json()).properties).toHaveLength(1);
  });

  it("visit requests: validation holds and cross-account access is denied", async () => {
    asBuyer(ids.buyerA);
    const future = new Date(Date.now() + 86400000).toISOString();
    const created = await (await routes.visits.POST(req("/api/buyer/visits", { method: "POST", body: { propertyId: ids.prop, scheduledAt: future } }))).json();
    const visitId = created.visit.id as string;
    expect((await routes.visits.POST(req("/api/buyer/visits", { method: "POST", body: { propertyId: "ghost", scheduledAt: future } }))).status).toBe(404);
    expect((await routes.visits.POST(req("/api/buyer/visits", { method: "POST", body: { propertyId: ids.prop, scheduledAt: new Date(Date.now() - 1000).toISOString() } }))).status).toBe(400);

    asBuyer(ids.buyerB);
    expect((await routes.visitById.GET(req(`/x`), { params: Promise.resolve({ id: visitId }) })).status).toBe(404);
    expect((await routes.visitById.PATCH(req(`/x`, { method: "PATCH", body: { notes: "hijack" } }), { params: Promise.resolve({ id: visitId }) })).status).toBe(404);
    expect((await routes.visitById.DELETE(req(`/x`, { method: "DELETE" }), { params: Promise.resolve({ id: visitId }) })).status).toBe(404);

    asBuyer(ids.buyerA);
    expect((await routes.visitById.PATCH(req(`/x`, { method: "PATCH", body: { status: "BOGUS" } }), { params: Promise.resolve({ id: visitId }) })).status).toBe(400);
    expect((await routes.visitById.DELETE(req(`/x`, { method: "DELETE" }), { params: Promise.resolve({ id: visitId }) })).status).toBe(200);
    // Already canceled: second cancel is rejected, not a fabricated success.
    expect((await routes.visitById.DELETE(req(`/x`, { method: "DELETE" }), { params: Promise.resolve({ id: visitId }) })).status).toBe(400);
  });

  it("comparisons are owned per buyer", async () => {
    asBuyer(ids.buyerA);
    // Unknown property IDs are rejected (404), never stored as ghosts.
    expect((await routes.comparisons.POST(req("/api/buyer/comparisons", { method: "POST", body: { propertyIds: [ids.prop, "ghost-2"] } }))).status).toBe(404);
    const created = await (await routes.comparisons.POST(req("/api/buyer/comparisons", { method: "POST", body: { propertyIds: [ids.prop, ids.prop2] } }))).json();
    const comparisonId = created.comparison.id as string;
    asBuyer(ids.buyerB);
    expect((await routes.comparisonById.GET(req(`/x`), { params: Promise.resolve({ id: comparisonId }) })).status).toBe(404);
    expect((await routes.comparisonById.DELETE(req(`/x`, { method: "DELETE" }), { params: Promise.resolve({ id: comparisonId }) })).status).toBe(404);
    asBuyer(ids.buyerA);
    expect((await routes.comparisonById.DELETE(req(`/x`, { method: "DELETE" }), { params: Promise.resolve({ id: comparisonId }) })).status).toBe(200);
  });

  it("recently-viewed rejects unknown properties and clears only self", async () => {
    asBuyer(ids.buyerA);
    expect((await routes.recent.POST(req("/api/buyer/recently-viewed", { method: "POST", body: { propertyId: "ghost" } }))).status).toBe(404);
    expect((await routes.recent.POST(req("/api/buyer/recently-viewed", { method: "POST", body: { propertyId: ids.prop } }))).status).toBe(200);
    asBuyer(ids.buyerB);
    await routes.recent.DELETE(req("/api/buyer/recently-viewed", { method: "DELETE" }));
    asBuyer(ids.buyerA);
    expect((await (await routes.recent.GET(req("/api/buyer/recently-viewed"))).json()).properties).toHaveLength(1);
  });

  it("profile reads/writes only the caller's own record", async () => {
    asBuyer(ids.buyerA);
    expect(await (await routes.profile.GET(req("/api/buyer/profile"))).json()).toMatchObject({
      profile: { id: ids.buyerA, name: "Buyer A", email: "a@buyers.test" },
    });
    expect(await (await routes.profile.PATCH(req("/api/buyer/profile", { method: "PATCH", body: { name: "Buyer A+", phone: "+91 1", email: "evil@x.test", role: "SUPER_ADMIN" } }))).json()).toMatchObject({
      profile: { id: ids.buyerA, name: "Buyer A+", email: "a@buyers.test", phone: "+91 1" },
    });
    asBuyer(ids.buyerB);
    expect(await (await routes.profile.GET(req("/api/buyer/profile"))).json()).toMatchObject({
      profile: { id: ids.buyerB, name: "Buyer B" },
    });
  });
});
