import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { leads, organizations, users } from "@/db/schema";
import { getPilotSummary } from "./pilot-summary";
import { getTenantAnalyticsSnapshot } from "./data/analytics";

const ORG = "pilot-summary-org";
const NOW = Date.parse("2026-09-19T12:00:00.000Z");

async function wipe() {
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

describe("pilot summary (factual, no fabrication)", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values({ id: ORG, name: "Summary Co", slug: `pilot-summary-${Date.now()}` });
    const pw = await bcrypt.hash("x", 4);
    await db.insert(users).values({
      id: "sum-manager", organizationId: ORG, name: "Sum Manager",
      email: "sum-manager@example.com", passwordHash: pw, role: "MANAGER",
    });
    await db.insert(leads).values([
      { id: "sum-q1", organizationId: ORG, source: "MANUAL", score: 70, temperature: "WARM", status: "QUALIFIED", budgetMaxInr: 5_000_000 },
      { id: "sum-n1", organizationId: ORG, source: "MANUAL", score: 20, temperature: "COLD", status: "NURTURE" },
      { id: "sum-w1", organizationId: ORG, source: "MANUAL", score: 90, temperature: "HOT", status: "CONVERTED", budgetMaxInr: 8_000_000 },
      { id: "sum-l1", organizationId: ORG, source: "MANUAL", score: 40, temperature: "COLD", status: "LOST" },
    ]);
  });

  afterAll(wipe);

  it("metrics match the underlying aggregations exactly", async () => {
    const [summary, analytics] = await Promise.all([
      getPilotSummary(ORG, { now: NOW }),
      getTenantAnalyticsSnapshot(ORG),
    ]);
    expect(summary.leadActivity.totalLeads).toBe(analytics.totalLeads);
    expect(summary.leadActivity.qualifiedLeads).toBe(analytics.qualifiedLeads);
    expect(summary.leadActivity.convertedLeads).toBe(analytics.convertedLeads);
    expect(summary.leadActivity.activeLeads).toBe(2); // QUALIFIED + NURTURE (open pipeline)
    expect(summary.leadActivity.dormantLeads).toBe(1); // NURTURE
    expect(summary.sales.wonDeals).toBe(analytics.convertedLeads);
  });

  it("period uses the workspace creation date, never a hardcoded window", async () => {
    const summary = await getPilotSummary(ORG, { now: NOW });
    expect(summary.period.start).toBeTruthy();
    expect(summary.period.label).toMatch(/^Pilot activity: \d{1,2} \w+ \d{4} – \d{1,2} \w+ \d{4}$/);
    expect(summary.period.label).not.toMatch(/30-day|30 days/i);
    expect(summary.period.end).toBe(new Date(NOW).toISOString());
  });

  it("at-risk and recovered revenue are separated; recovered is never a number", async () => {
    const summary = await getPilotSummary(ORG, { now: NOW });
    expect(typeof summary.revenueRisk.revenueAtRisk).toBe("number");
    expect(summary.sales.recoveredRevenue).toBeNull();
    expect(summary.sales.recoveredRevenueNote).toMatch(/not confirmed/i);
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/recoveredRevenue":\s*[0-9]/);
    expect(json).not.toMatch(/ROI|roi|guarantee/i);
    expect(summary.honestyNote).toMatch(/different metric/);
  });

  it("agent scoping is respected where the engines support it", async () => {
    const scoped = await getPilotSummary(ORG, { now: NOW, assignedAgentId: "sum-manager" });
    expect(scoped.organizationId).toBe(ORG);
    // Unassigned fixture leads remain visible to the scoped view (own + unassigned).
    expect(scoped.leadActivity.totalLeads).toBe(4);
  });
});
