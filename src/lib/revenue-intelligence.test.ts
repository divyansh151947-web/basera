import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import { conversations, followUps, leads, messages, organizations, tasks, users } from "@/db/schema";
import { getRevenueIntelligence } from "./revenue-intelligence";
import { getOrganizationRevenueRisk } from "./revenue-at-risk";
import { getOrganizationRecoveryCandidates } from "./recovery-engine";
import { getOrganizationNextBestActions } from "./next-best-action";

const ORG = "ri-test-org";
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const H = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

async function wipe() {
  await db.delete(tasks).where(eq(tasks.organizationId, ORG));
  await db.delete(messages).where(eq(messages.conversationId, "ri-convo"));
  await db.delete(followUps).where(eq(followUps.organizationId, ORG));
  await db.delete(conversations).where(eq(conversations.organizationId, ORG));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

describe("revenue intelligence aggregation", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values({ id: ORG, name: "Intel Test", slug: `ri-test-${Date.now()}` });
    const pw = await bcrypt.hash("x", 4);
    await db.insert(users).values([
      { id: "ri-manager", organizationId: ORG, name: "RI Manager", email: "ri-manager@example.com", passwordHash: pw, role: "MANAGER" },
      { id: "ri-agent", organizationId: ORG, name: "RI Agent", email: "ri-agent@example.com", passwordHash: pw, role: "SALES_AGENT" },
    ]);
    await db.insert(leads).values([
      { id: "ri-risky", organizationId: ORG, source: "WEBSITE_CHAT", score: 84, temperature: "HOT", status: "INTERESTED", budgetMaxInr: 8_500_000, assignedAgentId: "ri-agent", nextFollowUpAt: H(5) },
      { id: "ri-calm", organizationId: ORG, source: "MANUAL", score: 30, temperature: "COLD", status: "NEW" },
      { id: "ri-closed", organizationId: ORG, source: "MANUAL", score: 95, temperature: "HOT", status: "CONVERTED", budgetMaxInr: 99_000_000 },
    ]);
    await db.insert(conversations).values({ id: "ri-convo", organizationId: ORG, leadId: "ri-risky", channel: "WEBSITE_CHAT", status: "AI_HANDLING" });
    await db.insert(messages).values({ conversationId: "ri-convo", sender: "LEAD", content: "still there?", createdAt: H(60) });
    await db.insert(followUps).values({ organizationId: ORG, leadId: "ri-risky", attemptNumber: 1, scheduledFor: H(30), channel: "WEBSITE_CHAT", status: "PENDING" });
  });

  afterAll(wipe);

  it("totals and counts match the risk engine exactly", async () => {
    const intel = await getRevenueIntelligence(ORG, { now: NOW });
    const risk = await getOrganizationRevenueRisk(ORG, { now: NOW });
    expect(intel.overview.totalRevenueAtRisk).toBe(risk.totalRevenueAtRisk);
    expect(intel.risk.counts).toEqual(risk.counts);
    expect(intel.risk.topRisks.map((r) => r.leadId)).toEqual(risk.topRisks.map((r) => r.leadId));
    expect(intel.overview.riskyLeads).toBe(intel.risk.topRisks.length);
    // Converted 99M lead excluded from every figure.
    expect(intel.overview.totalRevenueAtRisk).toBeLessThan(99_000_000);
  });

  it("reuses recovery and NBA engines without duplicating their outputs", async () => {
    const intel = await getRevenueIntelligence(ORG, { now: NOW });
    const recovery = await getOrganizationRecoveryCandidates(ORG, { now: NOW });
    const nba = await getOrganizationNextBestActions(ORG, { now: NOW });
    expect(intel.overview.recoveryCandidates).toBe(recovery.candidates.length);
    expect(intel.recovery.candidates.map((c) => c.leadId).sort()).toEqual(recovery.candidates.map((c) => c.leadId).sort());
    expect(intel.nextBest.actions.map((a) => [a.leadId, a.action])).toEqual(nba.actions.map((a) => [a.leadId, a.action]));
  });

  it("agent view is scoped; foreign org sees nothing", async () => {
    const agent = await getRevenueIntelligence(ORG, { now: NOW, assignedAgentId: "ri-agent" });
    expect(agent.scopedToAgentId).toBe("ri-agent");
    expect(agent.agentTable.map((a) => a.agentId)).toEqual(["ri-agent"]);
    const foreign = await getRevenueIntelligence("org-that-does-not-exist", { now: NOW });
    expect(foreign.overview.totalRevenueAtRisk).toBe(0);
    expect(foreign.overview.riskyLeads).toBe(0);
    expect(foreign.agentTable).toEqual([]);
    expect(foreign.recovery.candidates).toEqual([]);
    expect(foreign.nextBest.actions).toEqual([]);
  });

  it("never fabricates recovered revenue or missing values", async () => {
    const intel = await getRevenueIntelligence(ORG, { now: NOW });
    // No recovered-revenue field may exist at all; the honesty note is the
    // only place the word may appear, stating tracking is NOT claimed.
    expect(intel).not.toHaveProperty("revenueRecovered");
    expect(JSON.stringify(intel)).not.toMatch(/revenueRecovered|guaranteed|will be lost|probability/i);
    expect(intel.honestyNote).toMatch(/confirmed deal outcomes/i);
    expect(intel.leakage.withoutSiteVisit.revenue).toBeGreaterThanOrEqual(0);
  });

  it("agent table and leakage read from real rows", async () => {
    const intel = await getRevenueIntelligence(ORG, { now: NOW });
    const row = intel.agentTable.find((a) => a.agentId === "ri-agent");
    expect(row?.activeLeads).toBe(1);
    expect(row?.atRiskLeads).toBe(1);
    expect(row?.needsAttention).toBe(true);
    expect(intel.leakage.byStage.some((s) => s.count > 0)).toBe(true);
    expect(intel.recoveryActivity.pendingFollowUps).toBe(1);
    expect(intel.overview.pendingActions).toBeGreaterThanOrEqual(0);
  });
});
