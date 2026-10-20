import { describe, expect, it, vi, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import {
  calculateLeadRevenueRisk,
  getOrganizationRevenueRisk,
  riskLevelForScore,
  type LeadRiskInput,
} from "./revenue-at-risk";
import { db } from "@/db/client";
import { conversations, followUps, leads, messages, organizations } from "@/db/schema";
import { eq } from "drizzle-orm";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const isoHoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const isoMinutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function base(overrides: Partial<LeadRiskInput> = {}): LeadRiskInput {
  return {
    leadId: "lead-test",
    score: 50,
    temperature: "WARM",
    status: "CONTACTED",
    overdueFollowUps: 0,
    ...overrides,
  };
}

describe("risk level thresholds", () => {
  it("maps score bands to levels", () => {
    expect(riskLevelForScore(0)).toBe("LOW");
    expect(riskLevelForScore(24)).toBe("LOW");
    expect(riskLevelForScore(25)).toBe("MEDIUM");
    expect(riskLevelForScore(49)).toBe("MEDIUM");
    expect(riskLevelForScore(50)).toBe("HIGH");
    expect(riskLevelForScore(74)).toBe("HIGH");
    expect(riskLevelForScore(75)).toBe("CRITICAL");
    expect(riskLevelForScore(100)).toBe("CRITICAL");
  });
});

describe("freshly active high-score lead stays LOW", () => {
  it("score 90 with a 10-minute-old exchange is LOW with no estimated amount", () => {
    const r = calculateLeadRevenueRisk(
      base({
        score: 90,
        temperature: "HOT",
        budgetMaxInr: 9_000_000,
        lastInboundAt: isoMinutesAgo(10),
        lastOutboundAt: isoMinutesAgo(5),
      }),
      NOW
    );
    expect(r.riskLevel).toBe("LOW");
    expect(r.riskScore).toBeLessThanOrEqual(24);
    expect(r.revenueAtRisk).toBeNull();
  });
});

describe("stale high-score lead with overdue follow-up climbs to HIGH", () => {
  function staleLead() {
    return base({
      leadId: "lead-stale",
      score: 82,
      temperature: "HOT",
      status: "INTERESTED",
      budgetMaxInr: 8_500_000,
      lastInboundAt: isoHoursAgo(49),
      lastOutboundAt: isoHoursAgo(50),
      followUpOverdue: true,
      overdueFollowUps: 1,
    });
  }

  it("reaches HIGH with the deal value at risk", () => {
    const r = calculateLeadRevenueRisk(staleLead(), NOW);
    expect(r.riskLevel).toBe("HIGH");
    expect(r.revenueAtRisk).toBe(8_500_000);
  });

  it("reasons name the actual triggered conditions", () => {
    const r = calculateLeadRevenueRisk(staleLead(), NOW);
    const joined = r.reasons.join(" | ");
    expect(joined).toMatch(/customer reply/i);
    expect(joined).toMatch(/follow-up/i);
    expect(joined).toMatch(/stalled|appointment/i);
    expect(r.reasons.every((reason) => reason.length > 10)).toBe(true);
  });
});

describe("overdue follow-ups raise risk, recent responses lower it", () => {
  it("an overdue follow-up moves an otherwise calm lead up", () => {
    const calm = calculateLeadRevenueRisk(base({ lastInboundAt: isoHoursAgo(10), lastOutboundAt: isoHoursAgo(9) }), NOW);
    const overdue = calculateLeadRevenueRisk(
      base({ lastInboundAt: isoHoursAgo(10), lastOutboundAt: isoHoursAgo(9), followUpOverdue: true, overdueFollowUps: 1 }),
      NOW
    );
    expect(overdue.riskScore).toBeGreaterThan(calm.riskScore);
    expect(overdue.reasons.join(" ")).toMatch(/overdue/i);
  });

  it("a recent agent response avoids the no-response penalty", () => {
    const waiting = calculateLeadRevenueRisk(base({ lastInboundAt: isoHoursAgo(30), lastOutboundAt: isoHoursAgo(30) }), NOW);
    const answered = calculateLeadRevenueRisk(base({ lastInboundAt: isoHoursAgo(30), lastOutboundAt: isoHoursAgo(1) }), NOW);
    expect(answered.riskScore).toBeLessThan(waiting.riskScore);
    expect(answered.reasons.join(" ")).not.toMatch(/agent response/i);
  });
});

describe("revenue estimation never invents money", () => {
  it("uses the matched property value when the lead is risky", () => {
    const r = calculateLeadRevenueRisk(
      base({
        score: 85,
        temperature: "HOT",
        status: "NEGOTIATION",
        lastInboundAt: isoHoursAgo(80),
        lastOutboundAt: isoHoursAgo(80),
        propertyId: "prop-1",
        propertyValue: 12_500_000,
        budgetMaxInr: 9_000_000,
      }),
      NOW
    );
    expect(r.riskLevel).not.toBe("LOW");
    expect(r.revenueAtRisk).toBe(12_500_000);
    expect(r.propertyId).toBe("prop-1");
  });

  it("returns null with an explanation when no value exists", () => {
    const r = calculateLeadRevenueRisk(
      base({ score: 85, temperature: "HOT", status: "NEGOTIATION", lastInboundAt: isoHoursAgo(80), lastOutboundAt: isoHoursAgo(80) }),
      NOW
    );
    expect(r.riskLevel).not.toBe("LOW");
    expect(r.revenueAtRisk).toBeNull();
    expect(r.reasons.join(" ")).toMatch(/no .* amount|no reliable/i);
  });

  it("closed and opted-out leads carry zero risk", () => {
    for (const status of ["CONVERTED", "LOST"]) {
      const r = calculateLeadRevenueRisk(base({ status, score: 95, budgetMaxInr: 50_000_000 }), NOW);
      expect(r.riskScore).toBe(0);
      expect(r.riskLevel).toBe("LOW");
      expect(r.revenueAtRisk).toBeNull();
    }
    const opted = calculateLeadRevenueRisk(base({ optedOut: true, score: 95 }), NOW);
    expect(opted.riskScore).toBe(0);
    expect(opted.revenueAtRisk).toBeNull();
  });
});

describe("organization summary aggregates real tenant data", () => {
  const ORG = "rar-test-org";

  afterAll(async () => {
    await db.delete(messages).where(eq(messages.conversationId, "rar-convo"));
    await db.delete(followUps).where(eq(followUps.leadId, "rar-risky"));
    await db.delete(conversations).where(eq(conversations.id, "rar-convo"));
    await db.delete(leads).where(eq(leads.organizationId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
  });

  it("counts levels, totals revenue, and isolates tenants", async () => {
    await db.delete(messages).where(eq(messages.conversationId, "rar-convo"));
    await db.delete(followUps).where(eq(followUps.leadId, "rar-risky"));
    await db.delete(conversations).where(eq(conversations.id, "rar-convo"));
    await db.delete(leads).where(eq(leads.organizationId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
    await db.insert(organizations).values({ id: ORG, name: "Risk Test Realty", slug: `rar-test-${Date.now()}` });
    await db.insert(leads).values([
      {
        id: "rar-risky",
        organizationId: ORG,
        source: "MANUAL",
        score: 84,
        temperature: "HOT",
        status: "INTERESTED",
        budgetMaxInr: 8_500_000,
        lastContactAt: isoHoursAgo(60),
        nextFollowUpAt: isoHoursAgo(5),
      },
      {
        id: "rar-calm",
        organizationId: ORG,
        source: "MANUAL",
        score: 90,
        temperature: "HOT",
        status: "CONTACTED",
        budgetMaxInr: 9_000_000,
        lastContactAt: isoMinutesAgo(10),
      },
      {
        id: "rar-closed",
        organizationId: ORG,
        source: "MANUAL",
        score: 95,
        temperature: "HOT",
        status: "CONVERTED",
        budgetMaxInr: 99_000_000,
      },
    ]);

    await db.insert(conversations).values({
      id: "rar-convo",
      organizationId: ORG,
      leadId: "rar-risky",
      channel: "WEBSITE_CHAT",
      status: "AI_HANDLING",
    });
    await db.insert(messages).values({
      conversationId: "rar-convo",
      sender: "LEAD",
      content: "Is this still available?",
      createdAt: isoHoursAgo(60),
    });
    await db.insert(followUps).values({
      organizationId: ORG,
      leadId: "rar-risky",
      attemptNumber: 1,
      scheduledFor: isoHoursAgo(5),
      channel: "WEBSITE_CHAT",
      status: "PENDING",
    });

    const summary = await getOrganizationRevenueRisk(ORG, { now: NOW });
    // Closed lead excluded; risky + calm evaluated.
    expect(summary.evaluatedLeads).toBe(2);
    expect(summary.counts.HIGH + summary.counts.CRITICAL).toBeGreaterThanOrEqual(1);
    expect(summary.counts.LOW).toBeGreaterThanOrEqual(1);
    expect(summary.totalRevenueAtRisk).toBeGreaterThan(0);
    // The converted 99M lead must not inflate the total.
    expect(summary.totalRevenueAtRisk).toBeLessThan(99_000_000);
    expect(summary.topRisks[0]?.leadId).toBe("rar-risky");
    expect(summary.calculatedAt).toBe(new Date(NOW).toISOString());

    // Tenant isolation: an unrelated org sees nothing, not even counts.
    const foreign = await getOrganizationRevenueRisk("org-that-does-not-exist", { now: NOW });
    expect(foreign.evaluatedLeads).toBe(0);
    expect(foreign.totalRevenueAtRisk).toBe(0);
    expect(foreign.topRisks).toEqual([]);
  });
});
