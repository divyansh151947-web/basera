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

/**
 * Buyer hardening regression tests: buyers may only cancel (never
 * self-complete) visits, notes are bounded, and preference ranges are
 * validated. Isolated temp DB; real dev.db untouched.
 */
describe("buyer hardening (isolated db)", () => {
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
      .values({ name: "Harden Demo", slug: "harden-demo", isDemo: true })
      .returning();
    const [prop] = await db
      .insert(schema.properties)
      .values({
        organizationId: org.id,
        projectName: "Harden Heights",
        propertyType: "APARTMENT",
        city: "Jaipur",
        locality: "Tonk Road",
        priceMinInr: 5000000,
        priceMaxInr: 7000000,
        availability: "AVAILABLE",
      })
      .returning();
    const [buyer] = await db
      .insert(schema.users)
      .values({ name: "Harden Buyer", email: "harden@buyers.test", passwordHash: "hash", role: "BUYER" })
      .returning();
    ids = { org: org.id, prop: prop.id, buyer: buyer.id };

    routes = {
      prefs: await import("@/app/api/buyer/preferences/route"),
      visits: await import("@/app/api/buyer/visits/route"),
      visitById: await import("@/app/api/buyer/visits/[id]/route"),
    };
  });

  afterAll(async () => {
    // Release the better-sqlite3 handle first: Windows cannot remove an
    // open database file, so close before deleting the owned directory.
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  it("buyers cannot self-mark visits COMPLETED/CONFIRMED, only CANCELED", async () => {
    asBuyer(ids.buyer);
    const future = new Date(Date.now() + 86400000).toISOString();
    const created = await (
      await routes.visits.POST(req("/api/buyer/visits", { method: "POST", body: { propertyId: ids.prop, scheduledAt: future } }))
    ).json();
    const visitId = created.visit.id as string;
    for (const status of ["COMPLETED", "CONFIRMED", "SCHEDULED", "NO_SHOW", "REQUESTED"]) {
      const res = await routes.visitById.PATCH(
        req("/x", { method: "PATCH", body: { status } }),
        { params: Promise.resolve({ id: visitId }) }
      );
      expect(res.status).toBe(400);
    }
    const ok = await routes.visitById.PATCH(
      req("/x", { method: "PATCH", body: { status: "CANCELED" } }),
      { params: Promise.resolve({ id: visitId }) }
    );
    expect(ok.status).toBe(200);
  });

  it("visit notes are bounded at 2000 chars on create and update", async () => {
    asBuyer(ids.buyer);
    const future = new Date(Date.now() + 86400000).toISOString();
    const long = "x".repeat(2001);
    expect(
      (await routes.visits.POST(req("/api/buyer/visits", { method: "POST", body: { propertyId: ids.prop, scheduledAt: future, notes: long } }))).status
    ).toBe(400);
    const created = await (
      await routes.visits.POST(req("/api/buyer/visits", { method: "POST", body: { propertyId: ids.prop, scheduledAt: future } }))
    ).json();
    const visitId = created.visit.id as string;
    expect(
      (await routes.visitById.PATCH(req("/x", { method: "PATCH", body: { notes: long } }), { params: Promise.resolve({ id: visitId }) })).status
    ).toBe(400);
  });

  it("preferences reject inverted ranges and out-of-domain values", async () => {
    asBuyer(ids.buyer);
    expect(
      (await routes.prefs.PATCH(req("/api/buyer/preferences", { method: "PATCH", body: { budgetMinInr: 9000000, budgetMaxInr: 8000000 } }))).status
    ).toBe(400);
    expect(
      (await routes.prefs.PATCH(req("/api/buyer/preferences", { method: "PATCH", body: { bhk: 99 } }))).status
    ).toBe(400);
    expect(
      (await routes.prefs.PATCH(req("/api/buyer/preferences", { method: "PATCH", body: { propertyType: "CASTLE" } }))).status
    ).toBe(400);
    expect(
      (await routes.prefs.PATCH(req("/api/buyer/preferences", { method: "PATCH", body: { minAreaSqft: 2000, maxAreaSqft: 1000 } }))).status
    ).toBe(400);
    // Sane values still accepted.
    expect(
      (await routes.prefs.PATCH(req("/api/buyer/preferences", { method: "PATCH", body: { budgetMinInr: 5000000, budgetMaxInr: 8000000, bhk: 3 } }))).status
    ).toBe(200);
  });
});
