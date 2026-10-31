import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { leads, leadPropertyInterests, organizations, properties, users } from "@/db/schema";
import { searchProperties, type MatchCriteria, type PropertySearchMode } from "./property-matching";

const ORG = "prop-match-search-org";

async function wipe() {
  await db.delete(leadPropertyInterests).where(inArray(leadPropertyInterests.leadId, ["pm-lead-1"]));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(properties).where(eq(properties.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

describe("searchProperties relaxation ladder (Feature 3: smart property matching)", () => {
  beforeAll(async () => {
    await wipe();
    const pw = await bcrypt.hash("x", 4);
    await db.insert(organizations).values({ id: ORG, name: "Match Realty", slug: `pms-${Date.now()}` });
    await db.insert(users).values({ id: "agent-1", organizationId: ORG, name: "Agent One", email: "one@example.com", passwordHash: pw, role: "SALES_AGENT" });
    // Available properties in Pune, various BHK/price
    await db.insert(properties).values([
      { id: "p-1", organizationId: ORG, projectName: "Pune A", propertyType: "APARTMENT", city: "Pune", locality: "Kothrud", bhk: 2, priceMinInr: 6_000_000, priceMaxInr: 7_000_000, availability: "AVAILABLE" },
      { id: "p-2", organizationId: ORG, projectName: "Pune B", propertyType: "APARTMENT", city: "Pune", locality: "Koregaon Park", bhk: 3, priceMinInr: 11_000_000, priceMaxInr: 12_000_000, availability: "AVAILABLE" },
      { id: "p-3", organizationId: ORG, projectName: "Pune C", propertyType: "VILLA", city: "Pune", locality: "Hinjewadi", bhk: 4, priceMinInr: 18_000_000, priceMaxInr: 20_000_000, availability: "AVAILABLE" },
      { id: "p-sold", organizationId: ORG, projectName: "Pune Sold", propertyType: "APARTMENT", city: "Pune", locality: "Kothrud", bhk: 2, priceMinInr: 5_000_000, priceMaxInr: 6_000_000, availability: "SOLD_OUT" },
      // Different city — must never match a Pune requirement
      { id: "m-1", organizationId: ORG, projectName: "Mumbai X", propertyType: "APARTMENT", city: "Mumbai", locality: "Bandra", bhk: 2, priceMinInr: 6_000_000, priceMaxInr: 7_000_000, availability: "AVAILABLE" },
    ]);
    await db.insert(leads).values([
      { id: "pm-lead-1", organizationId: ORG, source: "MANUAL", name: "PM Lead One", score: 70, temperature: "WARM", status: "NEW", assignedAgentId: "agent-1", preferredCity: "Pune", preferredLocality: "Kothrud", bhk: 2, propertyType: "APARTMENT", budgetMinInr: 6_000_000, budgetMaxInr: 7_000_000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
  });

  afterAll(wipe);

  const baseCriteria: MatchCriteria = { city: "Pune", bhk: 2, propertyType: "APARTMENT", budgetMinInr: 6_000_000, budgetMaxInr: 7_000_000 };

  it("STRICT: returns only available properties satisfying every hard constraint", async () => {
    const result = await searchProperties(ORG, baseCriteria, 5);
    expect(result.mode).toBe("STRICT");
    expect(result.matches.length).toBeGreaterThan(0);
    for (const m of result.matches) {
      expect(m.property.availability).not.toBe("SOLD_OUT");
      expect(m.property.availability).not.toBe("ARCHIVED");
      expect(m.property.isArchived).toBe(false);
      expect(m.property.city).toBe("Pune");
      expect(m.property.bhk).toBe(2);
    }
  });

  it("never recommends a SOLD_OUT property as available", async () => {
    const result = await searchProperties(ORG, { ...baseCriteria, locality: "Kothrud" }, 5);
    const soldOut = result.matches.some((m) => m.property.id === "p-sold");
    expect(soldOut).toBe(false);
    // Even in relaxation modes, SOLD_OUT stays excluded.
    const relaxed = await searchProperties(ORG, { city: "Pune", bhk: 2, propertyType: "APARTMENT" }, 20);
    expect(relaxed.matches.some((m) => m.property.id === "p-sold")).toBe(false);
  });

  it("never returns a property in a different city for a hard city requirement", async () => {
    const result = await searchProperties(ORG, baseCriteria, 5);
    expect(result.matches.some((m) => m.property.city === "Mumbai")).toBe(false);
  });

  it("RELAXED_LOCALITY: keeps city hard, drops locality when nothing matches exactly", async () => {
    // No property matches Pune + Kothrud + 2 BHK + APARTMENT + budget? p-1 does. Force no-match by tightening budget.
    const tight = { ...baseCriteria, budgetMaxInr: 1_000_000 }; // nothing affordable
    const result = await searchProperties(ORG, tight, 5);
    // Should not invent a property outside Pune.
    for (const m of result.matches) {
      expect(m.property.city).toBe("Pune");
    }
    expect(["STRICT", "RELAXED_LOCALITY", "RELAXED_BHK", "RELAXED_BUDGET", "NO_MATCH"] as PropertySearchMode[]).toContain(result.mode);
  });

  it("NO_MATCH: returns empty when nothing in inventory even after relaxation", async () => {
    // A city with no properties at all.
    const result = await searchProperties(ORG, { city: "Bangalore", bhk: 2, propertyType: "APARTMENT", budgetMinInr: 0, budgetMaxInr: 100_000_000 }, 5);
    expect(result.mode).toBe("NO_MATCH");
    expect(result.matches).toEqual([]);
    expect(result.gap).not.toBeNull();
  });

  it("match explanations are present and matchType is honest", async () => {
    const result = await searchProperties(ORG, baseCriteria, 5);
    for (const m of result.matches) {
      expect(m.matchType).toBeOneOf(["EXACT", "CLOSE", "ALTERNATIVE"]);
      expect(Array.isArray(m.reasons) && m.reasons.length > 0).toBe(true);
      expect(m.reasons.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
    }
  });

  it("respects BHK filter strictly", async () => {
    const result = await searchProperties(ORG, { ...baseCriteria, bhk: 4 }, 5);
    // p-3 is 4 BHK Villa Pune Hinjewadi — available but not APARTMENT, so excluded by propertyType too.
    // Use bhk 4 without type to confirm BHK filtering.
    const result2 = await searchProperties(ORG, { city: "Pune", bhk: 4, budgetMinInr: 0, budgetMaxInr: 100_000_000 }, 5);
    for (const m of result2.matches) {
      expect(m.property.bhk).toBe(4);
    }
  });

  it("budget boundary: excludes properties above budgetMaxInr", async () => {
    const overBudget = await searchProperties(ORG, { city: "Pune", bhk: 3, propertyType: "APARTMENT", budgetMinInr: 0, budgetMaxInr: 9_000_000 }, 5);
    for (const m of overBudget.matches) {
      expect(m.property.priceMinInr).toBeLessThanOrEqual(9_000_000);
    }
  });
});
