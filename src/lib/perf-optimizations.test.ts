import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";

/**
 * Performance-optimization regression tests (Phase F):
 * SQL-level pagination returns identical pages to the legacy full-read path,
 * and parallelized reads preserve validation/authorization semantics.
 * Isolated temp database only; never touches dev.db.
 */
describe("perf optimizations (isolated db)", () => {
  let testDb: IsolatedTestDb;
  let org = "";

  beforeAll(async () => {
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const [o] = await db.insert(schema.organizations).values({ name: "Perf Org", slug: "perf-org" }).returning();
    org = o.id;
    for (let i = 0; i < 25; i += 1) {
      await db.insert(schema.properties).values({
        organizationId: org,
        projectName: `Proj ${String(i).padStart(2, "0")}`,
        city: "Jaipur",
        locality: "Loc",
        propertyType: "APARTMENT",
        priceMinInr: 100 + i,
        priceMaxInr: 200 + i,
        availability: "AVAILABLE",
      });
    }
    for (let i = 0; i < 30; i += 1) {
      await db.insert(schema.leads).values({
        organizationId: org,
        name: `Lead ${String(i).padStart(2, "0")}`,
        source: "MANUAL",
        status: "NEW",
      });
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  it("paged property reads match legacy full-read pages", async () => {
    const { listProperties } = await import("@/lib/data/properties");
    const { paginateList } = await import("@/lib/pagination");
    const full = await listProperties(org, {});
    for (const [limit, offset] of [[10, 0], [10, 10], [10, 20], [50, 0]] as const) {
      const paged = await listProperties(org, {}, { limit, offset });
      const legacy = paginateList(full, { limit, offset });
      expect(paged.slice(0, limit).map((p) => p.id)).toEqual(legacy.items.map((p) => p.id));
      expect(paged.length > limit).toBe(legacy.hasMore);
    }
  });

  it("paged lead reads match legacy pages for managers", async () => {
    const { listLeads } = await import("@/lib/data/leads");
    const { paginateList } = await import("@/lib/pagination");
    const full = await listLeads(org, {});
    for (const [limit, offset] of [[10, 0], [10, 25]] as const) {
      const paged = await listLeads(org, {}, { limit, offset });
      const legacy = paginateList(full, { limit, offset });
      expect(paged.slice(0, limit).map((l) => l.id)).toEqual(legacy.items.map((l) => l.id));
      expect(paged.length > limit).toBe(legacy.hasMore);
    }
  });

  it("paged appointments/conversations match legacy pages", async () => {
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const { listAppointments } = await import("@/lib/data/org");
    const { listConversations } = await import("@/lib/data/conversations");
    const { createLead } = await import("@/lib/data/leads");
    const { paginateList } = await import("@/lib/pagination");
    const lead = await createLead(org, { name: "Conv Lead", source: "MANUAL" } as any);
    for (let i = 0; i < 8; i += 1) {
      await db.insert(schema.appointments).values({
        organizationId: org,
        leadId: lead.id,
        type: "CALL",
        scheduledAt: new Date(Date.now() + (i + 1) * 3600000).toISOString(),
      });
    }
    const fullA = await listAppointments(org);
    const pagedA = await listAppointments(org, { limit: 5, offset: 0 });
    const legacyA = paginateList(fullA, { limit: 5, offset: 0 });
    expect(pagedA.slice(0, 5).map((a) => a.id)).toEqual(legacyA.items.map((a) => a.id));
    expect(pagedA.length > 5).toBe(legacyA.hasMore);

    const fullC = await listConversations(org, {});
    const pagedC = await listConversations(org, {}, { limit: 5, offset: 0 });
    const legacyC = paginateList(fullC, { limit: 5, offset: 0 });
    expect(pagedC.slice(0, 5).map((c) => c.id)).toEqual(legacyC.items.map((c) => c.id));
    expect(pagedC.length > 5).toBe(legacyC.hasMore);
  });

  it("parallel comparison validation keeps request-order 404 semantics", async () => {
    const { resolveComparisonProperties } = await import("@/lib/data/buyer");
    const r = await resolveComparisonProperties(["nope-1", "nope-2"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("knowledge stats still aggregate after parallelization", async () => {
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    await db.insert(schema.knowledgeDocuments).values({ organizationId: org, type: "FAQ", title: "T", content: "C" });
    const { getKnowledgeStats } = await import("@/lib/knowledge/retrieval");
    const stats = await getKnowledgeStats(org);
    expect(stats.totalDocuments).toBeGreaterThanOrEqual(1);
    expect(stats.byType.FAQ).toBeGreaterThanOrEqual(1);
  });

  it("dynamic bundle targets are wired (source-level)", async () => {
    const fs = await import("node:fs");
    const detail = fs.readFileSync("src/app/(public)/explore/[id]/page.tsx", "utf8");
    // recharts must never be statically imported by the detail page, and the
    // chart itself must be gated behind the viewport-lazy client wrapper
    // (declaring dynamic() directly in this Server Component still put the
    // recharts chunk into the page's eager startup chunk list).
    expect(detail).toMatch(/from "\.\/LazyPriceHistoryChart"/);
    expect(detail).not.toMatch(/import \{ PriceHistoryChart \} from "\.\/PriceHistoryChart"/);
    expect(detail).not.toMatch(/from "recharts"/);
    const chartWrapper = fs.readFileSync("src/app/(public)/explore/[id]/LazyPriceHistoryChart.tsx", "utf8");
    expect(chartWrapper).toMatch(/^"use client";/m);
    expect(chartWrapper).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\("\.\/PriceHistoryChart"\)/);
    const dash = fs.readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8");
    expect(dash).toMatch(/RevenueTower/);
    expect(dash).toMatch(/dynamic/);
    expect(dash).not.toMatch(/import \{ RevenueTower \} from "@\/components\/property-tour\/RevenueTower"/);
    const tour = fs.readFileSync("src/app/tour/page.tsx", "utf8");
    expect(tour).toMatch(/dynamic\(\(\) => import\("@\/components\/property-tour\/PropertyTour"\)/);
    const home = fs.readFileSync("src/app/page.tsx", "utf8");
    // Homepage 3D sections must stay viewport-gated so three.js (~190 KB)
    // stays out of the post-hydration critical path.
    expect(home).toMatch(/<LazySection/);
    const gallery = fs.readFileSync("src/app/(public)/explore/[id]/PropertyGallery.tsx", "utf8");
    // Fullscreen dialog image must not carry priority (only the LCP main image does).
    const dialogBlock = gallery.slice(gallery.indexOf("{isFullscreen &&"));
    expect(dialogBlock).not.toMatch(/priority/);
  });
});
