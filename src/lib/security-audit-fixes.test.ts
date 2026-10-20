import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";
import { escapeLikePattern, likeContains } from "@/lib/safe-like";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Security-audit regression tests (Phase D):
 * - Data-layer tenant-override hardening (organizationId/id can never escape session tenant)
 * - LIKE wildcard escaping (search text matched literally)
 * - Cron timing-safe authorization
 * Uses an isolated temp database; never touches dev.db.
 */
describe("security audit fixes (isolated db)", () => {
  let testDb: IsolatedTestDb;
  let orgA = "";
  let orgB = "";

  beforeAll(async () => {
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const [a] = await db.insert(schema.organizations).values({ name: "Sec A", slug: "sec-a" }).returning();
    const [b] = await db.insert(schema.organizations).values({ name: "Sec B", slug: "sec-b" }).returning();
    orgA = a.id;
    orgB = b.id;
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  it("escapeLikePattern neutralizes %, _, and backslash", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    expect(likeContains("a%b")).toBe("%a\\%b%");
    expect(likeContains("plain")).toBe("%plain%");
  });

  it("createLead ignores smuggled organizationId/id and keeps session tenant", async () => {
    const { createLead, getLeadById, updateLead } = await import("@/lib/data/leads");
    const lead = await createLead(orgA, { name: "Smuggle", source: "MANUAL", organizationId: orgB, id: "evil-id" } as any);
    expect(lead.organizationId).toBe(orgA);
    expect(lead.id).not.toBe("evil-id");
    expect(await getLeadById(orgB, lead.id)).toBeNull();
    expect((await getLeadById(orgA, lead.id))?.id).toBe(lead.id);

    // Update can never reparent the row.
    const updated = await updateLead(orgA, lead.id, { organizationId: orgB, name: "Renamed" } as any);
    expect(updated?.organizationId).toBe(orgA);
    expect(updated?.name).toBe("Renamed");
  });

  it("createProperty/updateProperty ignore smuggled tenant fields", async () => {
    const { createProperty, getPropertyById, updateProperty } = await import("@/lib/data/properties");
    const prop = await createProperty(orgA, {
      projectName: "Proj",
      city: "Jaipur",
      locality: "Malviya",
      propertyType: "APARTMENT",
      priceMinInr: 100,
      priceMaxInr: 200,
      organizationId: orgB,
      id: "evil-prop",
    } as any);
    expect(prop.organizationId).toBe(orgA);
    expect(prop.id).not.toBe("evil-prop");
    expect(await getPropertyById(orgB, prop.id)).toBeNull();

    const updated = await updateProperty(orgA, prop.id, { organizationId: orgB, projectName: "Proj2" } as any);
    expect(updated?.organizationId).toBe(orgA);
  });

  it("createAppointment ignores smuggled tenant fields", async () => {
    const { createAppointment } = await import("@/lib/data/org");
    const { createLead } = await import("@/lib/data/leads");
    const lead = await createLead(orgA, { name: "Appt Lead", source: "MANUAL" } as any);
    const appt = await createAppointment(orgA, {
      leadId: lead.id,
      type: "CALL",
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      organizationId: orgB,
      id: "evil-appt",
    } as any);
    expect(appt.organizationId).toBe(orgA);
    expect(appt.id).not.toBe("evil-appt");
  });

  it("lead search treats % and _ literally (no wildcard blowup)", async () => {
    const { createLead, listLeads } = await import("@/lib/data/leads");
    await createLead(orgA, { name: "Alice Wonder", source: "MANUAL" } as any);
    await createLead(orgA, { name: "Bob Builder", source: "MANUAL" } as any);
    // A bare % must not match everything now that it is escaped.
    const pct = await listLeads(orgA, { search: "%" });
    expect(pct.filter((l) => l.name === "Alice Wonder" || l.name === "Bob Builder")).toEqual([]);
    // Underscore must not act as single-char wildcard.
    const under = await listLeads(orgA, { search: "_" });
    expect(under.filter((l) => l.name === "Alice Wonder" || l.name === "Bob Builder")).toEqual([]);
    // Normal substring still works.
    const alice = await listLeads(orgA, { search: "Alice" });
    expect(alice.map((l) => l.name)).toContain("Alice Wonder");
  });

  it("isCronAuthorized fails closed and compares timing-safely", () => {
    const prev = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = "s3cr3t-value";
      expect(isCronAuthorized("s3cr3t-value")).toBe(true);
      expect(isCronAuthorized("s3cr3t-valuX")).toBe(false);
      expect(isCronAuthorized("short")).toBe(false);
      expect(isCronAuthorized(null)).toBe(false);
      expect(isCronAuthorized(undefined)).toBe(false);
      expect(isCronAuthorized("")).toBe(false);
      delete process.env.CRON_SECRET;
      expect(isCronAuthorized("s3cr3t-value")).toBe(false);
      process.env.CRON_SECRET = "";
      expect(isCronAuthorized("s3cr3t-value")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
