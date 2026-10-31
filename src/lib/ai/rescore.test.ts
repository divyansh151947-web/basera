import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { leads, organizations, users } from "@/db/schema";
import { createLead } from "@/lib/data/leads";
import { rescoreLead } from "./rescore";

const ORG = "rescore-test-org";
const NOW = Date.parse("2026-09-20T12:00:00.000Z");

async function wipe() {
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

describe("rescoreLead (DB-backed, tenant-scored)", () => {
  let leadId: string;

  beforeAll(async () => {
    await wipe();
    const pw = await bcrypt.hash("x", 4);
    await db.insert(organizations).values({ id: ORG, name: "Rescore Realty", slug: `rs-${Date.now()}` });
    await db.insert(users).values({ id: "agent-1", organizationId: ORG, name: "Agent One", email: "one@example.com", passwordHash: pw, role: "SALES_AGENT" });
    const lead = await createLead(ORG, {
      source: "MANUAL",
      name: "Rs Lead One",
      score: 0,
      temperature: "COLD",
      status: "NEW",
      assignedAgentId: "agent-1",
      budgetMaxInr: 8_000_000,
      preferredCity: "Pune",
      bhk: 2,
      timeline: "2 months",
      siteVisitInterest: true,
      loanRequired: false,
    });
    leadId = lead.id;
  });

  afterAll(wipe);

  it("calculates and persists a transparent score with a score event", async () => {
    const outcome = await rescoreLead(ORG, leadId, { reason: "Test recalculation" });
    expect(outcome).not.toBeNull();
    expect(outcome!.scoreResult.score).toBeGreaterThan(0);
    expect(outcome!.scoreResult.score).toBeLessThanOrEqual(100);
    expect(outcome!.reason).toContain("Test recalculation");
    // Breakdown is explainable: every factor names points/max.
    expect(outcome!.scoreResult.breakdown.length).toBeGreaterThan(0);
    expect(outcome!.scoreResult.breakdown.every((b) => typeof b.points === "number" && typeof b.max === "number")).toBe(true);
    // The lead row itself is updated.
    const row = await db.select({ score: leads.score, temperature: leads.temperature }).from(leads).where(eq(leads.id, leadId));
    expect(row[0]!.score).toBe(outcome!.scoreResult.score);
    expect(row[0]!.temperature).toBe(outcome!.scoreResult.temperature);
  });

  it("returns null for a lead in another organization (tenant isolation)", async () => {
    const outcome = await rescoreLead("other-org", leadId);
    expect(outcome).toBeNull();
  });

  it("returns null for a missing lead", async () => {
    const outcome = await rescoreLead(ORG, "does-not-exist");
    expect(outcome).toBeNull();
  });
});
