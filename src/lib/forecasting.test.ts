import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { leads, leadPropertyInterests, organizations, properties, users } from "@/db/schema";
import {
  calculateForecast,
  DEFAULT_STAGE_PROBABILITIES,
} from "./forecasting";

const ORG = "forecast-test-org";
const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const FC_LEAD_IDS = ["fc-n1", "fc-neg1", "fc-q1", "fc-c1", "fc-won", "fc-lost"];

async function wipe() {
  await db.delete(leadPropertyInterests).where(inArray(leadPropertyInterests.leadId, FC_LEAD_IDS));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(properties).where(eq(properties.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

describe("sales forecasting (deterministic, no fabricated revenue)", () => {
  beforeAll(async () => {
    await wipe();
    const pw = await bcrypt.hash("x", 4);
    await db.insert(organizations).values({ id: ORG, name: "Forecast Realty", slug: `fc-${Date.now()}` });
    await db.insert(users).values([
      { id: "agent-a", organizationId: ORG, name: "Agent A", email: "a@example.com", passwordHash: pw, role: "SALES_AGENT" },
      { id: "agent-b", organizationId: ORG, name: "Agent B", email: "b@example.com", passwordHash: pw, role: "SALES_AGENT" },
      { id: "mgr-1", organizationId: ORG, name: "Manager", email: "m@example.com", passwordHash: pw, role: "MANAGER" },
    ]);
    // prop-A midpoint 5,500,000; prop-B midpoint 12,500,000
    await db.insert(properties).values([
      { id: "prop-a", organizationId: ORG, projectName: "Property A", propertyType: "APARTMENT", city: "Pune", locality: "Kothrud", priceMinInr: 5_000_000, priceMaxInr: 6_000_000, availability: "AVAILABLE" },
      { id: "prop-b", organizationId: ORG, projectName: "Property B", propertyType: "APARTMENT", city: "Pune", locality: "Koregaon Park", priceMinInr: 12_000_000, priceMaxInr: 13_000_000, availability: "AVAILABLE" },
    ]);
    await db.insert(leads).values([
      // NEW, matched prop-a (midpoint 55L), assigned agent-a
      { id: "fc-n1", organizationId: ORG, source: "MANUAL", name: "Lead N1", score: 30, temperature: "COLD", status: "NEW", assignedAgentId: "agent-a", budgetMaxInr: 5_000_000, createdAt: new Date(NOW - 10 * 86_400_000).toISOString(), updatedAt: new Date(NOW - 10 * 86_400_000).toISOString() },
      // NEGOTIATION, matched prop-b (midpoint 1.25Cr), assigned agent-a
      { id: "fc-neg1", organizationId: ORG, source: "MANUAL", name: "Lead Neg1", score: 80, temperature: "HOT", status: "NEGOTIATION", assignedAgentId: "agent-a", budgetMaxInr: 13_000_000, createdAt: new Date(NOW - 5 * 86_400_000).toISOString(), updatedAt: new Date(NOW - 5 * 86_400_000).toISOString() },
      // QUALIFIED, no value on file, assigned agent-b
      { id: "fc-q1", organizationId: ORG, source: "MANUAL", name: "Lead Q1", score: 50, temperature: "WARM", status: "QUALIFIED", assignedAgentId: "agent-b", budgetMaxInr: null, createdAt: new Date(NOW - 7 * 86_400_000).toISOString(), updatedAt: new Date(NOW - 7 * 86_400_000).toISOString() },
      // CONTACTED, budget 80L but no property match → value 80L, unassigned
      { id: "fc-c1", organizationId: ORG, source: "MANUAL", name: "Lead C1", score: 40, temperature: "WARM", status: "CONTACTED", assignedAgentId: null, budgetMaxInr: 8_000_000, createdAt: new Date(NOW - 3 * 86_400_000).toISOString(), updatedAt: new Date(NOW - 3 * 86_400_000).toISOString() },
      // CONVERTED closed (historical)
      { id: "fc-won", organizationId: ORG, source: "MANUAL", name: "Lead Won", score: 90, temperature: "HOT", status: "CONVERTED", assignedAgentId: "agent-a", budgetMaxInr: 10_000_000, createdAt: new Date(NOW - 20 * 86_400_000).toISOString(), updatedAt: new Date(NOW - 2 * 86_400_000).toISOString() },
      // LOST closed
      { id: "fc-lost", organizationId: ORG, source: "MANUAL", name: "Lead Lost", score: 20, temperature: "COLD", status: "LOST", assignedAgentId: "agent-b", budgetMaxInr: 4_000_000, createdAt: new Date(NOW - 25 * 86_400_000).toISOString(), updatedAt: new Date(NOW - 3 * 86_400_000).toISOString() },
    ]);
    // Interests: fc-n1 -> prop-a; fc-neg1 -> prop-b
    await db.insert(leadPropertyInterests).values([
      { id: "lpi-1", leadId: "fc-n1", propertyId: "prop-a", matchType: "EXACT", matchScore: 90, createdAt: new Date(NOW - 10 * 86_400_000).toISOString() },
      { id: "lpi-2", leadId: "fc-neg1", propertyId: "prop-b", matchType: "CLOSE", matchScore: 75, createdAt: new Date(NOW - 5 * 86_400_000).toISOString() },
    ]);
  });

  afterAll(wipe);

  it("applies stage probabilities and computes weighted pipeline", async () => {
    const result = await calculateForecast(ORG, { asOf: NOW });

    // fc-n1: NEW (5%), midpoint 5,500,000 → weighted 275,000
    // fc-neg1: NEGOTIATION (80%), midpoint 12,500,000 → weighted 10,000,000
    // fc-q1: QUALIFIED (25%), no value → 0
    // fc-c1: CONTACTED (10%), budget 8,000,000 → weighted 800,000
    expect(result.openLeadCount).toBe(4);
    expect(result.pipelineValue).toBe(5_500_000 + 12_500_000 + 8_000_000); // fc-q1 excluded (no value)
    expect(result.weightedPipelineValue).toBe(275_000 + 10_000_000 + 800_000);
    expect(result.expectedRevenue).toBe(result.weightedPipelineValue);
    expect(result.expectedClosures).toBeCloseTo(0.05 + 0.80 + 0.25 + 0.10, 2);
    expect(result.leadsWithValue).toBe(3);
    expect(result.leadsWithoutValue).toBe(1);
  });

  it("never invents value: leads without value contribute zero weighted value", async () => {
    const result = await calculateForecast(ORG, { asOf: NOW });
    const qualifiedRow = result.pipelineByStage.find((r) => r.stage === "QUALIFIED");
    expect(qualifiedRow).toBeDefined();
    expect(qualifiedRow!.leadCount).toBe(1);
    expect(qualifiedRow!.value).toBe(0);
    expect(qualifiedRow!.weightedValue).toBe(0);
  });

  it("pipeline by stage reflects correct counts and probabilities", async () => {
    const result = await calculateForecast(ORG, { asOf: NOW });
    const byStage = Object.fromEntries(result.pipelineByStage.map((r) => [r.stage, r]));
    expect(byStage["NEW"].leadCount).toBe(1);
    expect(byStage["NEW"].probability).toBe(DEFAULT_STAGE_PROBABILITIES.NEW);
    expect(byStage["NEGOTIATION"].probability).toBe(DEFAULT_STAGE_PROBABILITIES.NEGOTIATION);
    expect(byStage["CONTACTED"].leadCount).toBe(1);
    expect(byStage["QUALIFIED"].leadCount).toBe(1);
    // Closed leads are excluded from open pipeline stages.
    expect(byStage["CONVERTED"]).toBeUndefined();
  });

  it("agent scoping returns only that agent's assigned leads", async () => {
    const scoped = await calculateForecast(ORG, { asOf: NOW, assignedAgentId: "agent-a" });
    expect(scoped.scopedToAgentId).toBe("agent-a");
    // Agent scope = own + unassigned: fc-n1, fc-neg1 (agent-a) + fc-c1 (unassigned)
    expect(scoped.openLeadCount).toBe(3);
    expect(scoped.pipelineValue).toBe(5_500_000 + 12_500_000 + 8_000_000);
    // Only assigned leads roll up to an agent row; fc-c1 is unassigned.
    const agentRows = scoped.agentForecasts.map((r) => ({ id: r.agentId, expected: r.expectedRevenue }));
    expect(agentRows.find((r) => r.id === "agent-a")?.expected).toBe(10_275_000);
    expect(agentRows.find((r) => r.id === "agent-b")).toBeUndefined();
  });

  it("insufficient history yields LOW confidence and no historical rate", async () => {
    const result = await calculateForecast(ORG, { asOf: NOW });
    // Only 1 conversion in window; below MIN_CLOSED_FOR_HISTORY (10)
    expect(result.hasSufficientHistory).toBe(false);
    expect(result.historicalConversionRateNull).toBe(true);
    expect(result.forecastConfidence).toBe("LOW");
    expect(result.confidenceReasons.some((r) => /not statistically meaningful|historical basis/.test(r))).toBe(true);
  });

  it("defaults are documented and within 0-100", () => {
    for (const [stage, p] of Object.entries(DEFAULT_STAGE_PROBABILITIES)) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
    expect(DEFAULT_STAGE_PROBABILITIES.NEW).toBe(5);
    expect(DEFAULT_STAGE_PROBABILITIES.NEGOTIATION).toBe(80);
    expect(DEFAULT_STAGE_PROBABILITIES.CONVERTED).toBe(100);
    expect(DEFAULT_STAGE_PROBABILITIES.LOST).toBe(0);
  });
});
