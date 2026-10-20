import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import {
  recommendNextBestAction,
  scoreActionPriority,
  getOrganizationNextBestActions,
  type NbaInput,
} from "./next-best-action";
import { db } from "@/db/client";
import { appointments, conversations, leads, messages, organizations, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");

function input(overrides: Partial<NbaInput> = {}): NbaInput {
  return {
    leadId: "lead-nba",
    status: "CONTACTED",
    leadScore: 70,
    riskLevel: "MEDIUM",
    riskScore: 40,
    riskReasons: ["Some risk reason."],
    hasValue: true,
    lastInboundHoursAgo: 30,
    lastOutboundHoursAgo: 30,
    followUpOverdue: false,
    overdueFollowUpCount: 0,
    pendingFollowUp: false,
    daysSinceLastAutoOutreach: null,
    openTaskExists: false,
    upcomingVisitInHours: null,
    upcomingVisitConfirmed: false,
    completedVisitWithoutFollowUp: false,
    hasAnyAppointment: false,
    qualifiedForVisit: false,
    hasStrongMatch: true,
    hasAnyInterest: true,
    handoffAwaitingHuman: false,
    channel: "WEBSITE_CHAT",
    recoveryAction: null,
    recoveryShouldAct: false,
    ...overrides,
  };
}

describe("core scenarios", () => {
  it("recent unanswered customer message → RESPOND_TO_CUSTOMER", () => {
    const r = recommendNextBestAction(input({ lastInboundHoursAgo: 2, lastOutboundHoursAgo: 30 }), NOW);
    expect(r.action).toBe("RESPOND_TO_CUSTOMER");
    expect(r.confidence).toBe("HIGH");
    expect(r.reason).toMatch(/message.*waiting|waiting.*response|no agent response/i);
  });

  it("upcoming site visit → CONFIRM_SITE_VISIT", () => {
    const r = recommendNextBestAction(
      input({ upcomingVisitInHours: 20, upcomingVisitConfirmed: false, lastInboundHoursAgo: 100, lastOutboundHoursAgo: 100 }),
      NOW
    );
    expect(r.action).toBe("CONFIRM_SITE_VISIT");
    expect(r.confidence).toBe("HIGH");
  });

  it("completed visit with silence after → FOLLOW_UP_AFTER_SITE_VISIT", () => {
    const r = recommendNextBestAction(
      input({ completedVisitWithoutFollowUp: true, lastInboundHoursAgo: 100, lastOutboundHoursAgo: 100 }),
      NOW
    );
    expect(r.action).toBe("FOLLOW_UP_AFTER_SITE_VISIT");
  });

  it("qualified + wants visit + nothing booked → BOOK_SITE_VISIT", () => {
    const r = recommendNextBestAction(
      input({ qualifiedForVisit: true, siteVisitInterest: true, hasAnyAppointment: false, lastInboundHoursAgo: 100, lastOutboundHoursAgo: 100 }),
      NOW
    );
    expect(r.action).toBe("BOOK_SITE_VISIT");
  });

  it("overdue follow-up via recovery mapping → FOLLOW_UP", () => {
    const r = recommendNextBestAction(
      input({ followUpOverdue: true, overdueFollowUpCount: 1, recoveryAction: "FOLLOW_UP", recoveryShouldAct: true }),
      NOW
    );
    expect(r.action).toBe("FOLLOW_UP");
  });

  it("repeated overdue + high risk → ESCALATE_TO_MANAGER", () => {
    const r = recommendNextBestAction(
      input({ riskLevel: "HIGH", riskScore: 70, recoveryAction: "MANAGER_ESCALATION", recoveryShouldAct: true }),
      NOW
    );
    expect(r.action).toBe("ESCALATE_TO_MANAGER");
  });

  it("dormant high-intent lead with value → REACTIVATE_LEAD", () => {
    const r = recommendNextBestAction(input({ lastInboundHoursAgo: 24 * 20, lastOutboundHoursAgo: 24 * 20 }), NOW);
    expect(r.action).toBe("REACTIVATE_LEAD");
  });

  it("interest without strong match → FIND_BETTER_PROPERTY", () => {
    const r = recommendNextBestAction(
      input({ hasStrongMatch: false, hasAnyInterest: true, lastInboundHoursAgo: 100, lastOutboundHoursAgo: 100, leadScore: 50 }),
      NOW
    );
    expect(r.action).toBe("FIND_BETTER_PROPERTY");
  });
});

describe("spam and terminal guards", () => {
  it("recently contacted lead → no customer-facing spam", () => {
    const r = recommendNextBestAction(input({ lastInboundHoursAgo: 1, lastOutboundHoursAgo: 0.5 }), NOW);
    expect(["WAIT_AND_MONITOR", "NO_ACTION"]).toContain(r.action);
  });

  it("closed lead → NO_ACTION", () => {
    for (const status of ["CONVERTED", "LOST"]) {
      const r = recommendNextBestAction(input({ status }), NOW);
      expect(r.action).toBe("NO_ACTION");
      expect(r.confidence).toBe("HIGH");
    }
  });

  it("opted-out lead → NO_ACTION", () => {
    expect(recommendNextBestAction(input({ optedOut: true }), NOW).action).toBe("NO_ACTION");
  });

  it("pending queue → WAIT_AND_MONITOR, never a send", () => {
    const r = recommendNextBestAction(input({ pendingFollowUp: true, lastInboundHoursAgo: 100, lastOutboundHoursAgo: 100 }), NOW);
    expect(["WAIT_AND_MONITOR", "NO_ACTION"]).toContain(r.action);
    expect(r.action).not.toBe("FOLLOW_UP");
  });
});

describe("priority, confidence, determinism", () => {
  it("urgency beats raw value: recent ₹2Cr message outranks dormant reactivation", () => {
    const urgent = recommendNextBestAction(
      input({ lastInboundHoursAgo: 0.1, lastOutboundHoursAgo: null, leadScore: 90, riskLevel: "HIGH", riskScore: 60, hasValue: true }),
      NOW
    );
    const dormant = recommendNextBestAction(
      input({ lastInboundHoursAgo: 24 * 30, lastOutboundHoursAgo: 24 * 30, leadScore: 90, riskLevel: "HIGH", riskScore: 60, hasValue: true }),
      NOW
    );
    expect(urgent.action).toBe("RESPOND_TO_CUSTOMER");
    expect(urgent.priority).toBeGreaterThan(dormant.priority);
  });

  it("recommendations are deterministic across runs", () => {
    const a = recommendNextBestAction(input({ lastInboundHoursAgo: 3, lastOutboundHoursAgo: 30 }), NOW);
    const b = recommendNextBestAction(input({ lastInboundHoursAgo: 3, lastOutboundHoursAgo: 30 }), NOW);
    expect(a).toEqual(b);
  });

  it("priority scores stay within 0–100", () => {
    expect(scoreActionPriority("RESPOND_TO_CUSTOMER", input({ lastInboundHoursAgo: 0.1, riskScore: 100, overdueFollowUpCount: 5, upcomingVisitInHours: 5, riskLevel: "CRITICAL" })).valueOf()).toBeLessThanOrEqual(100);
    for (const action of ["FOLLOW_UP", "BOOK_SITE_VISIT", "WAIT_AND_MONITOR", "NO_ACTION"] as const) {
      const p = scoreActionPriority(action, input({}));
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  it("no money or odds are ever invented", () => {
    const r = recommendNextBestAction(input({ hasValue: false, revenueAtRisk: null }), NOW);
    expect(r.revenueAtRisk).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/probability|guaranteed|will close|definitely/i);
  });
});

describe("organization scope and tenant isolation", () => {
  const ORG = "nba-test-org";
  const H = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
  const FUT = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

  async function wipe() {
    await db.delete(messages).where(eq(messages.conversationId, "nba-convo"));
    await db.delete(appointments).where(eq(appointments.organizationId, ORG));
    await db.delete(conversations).where(eq(conversations.organizationId, ORG));
    await db.delete(leads).where(eq(leads.organizationId, ORG));
    await db.delete(users).where(eq(users.organizationId, ORG));
    await db.delete(organizations).where(eq(organizations.id, ORG));
  }

  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values({ id: ORG, name: "NBA Test", slug: `nba-test-${Date.now()}` });
    const pw = await bcrypt.hash("x", 4);
    await db.insert(users).values([
      { id: "nba-agent", organizationId: ORG, name: "NBA Agent", email: "nba-agent@example.com", passwordHash: pw, role: "SALES_AGENT" },
      { id: "nba-other", organizationId: ORG, name: "NBA Other", email: "nba-other@example.com", passwordHash: pw, role: "SALES_AGENT" },
    ]);
    await db.insert(leads).values([
      { id: "nba-waiting", organizationId: ORG, source: "MANUAL", score: 85, temperature: "HOT", status: "CONTACTED", budgetMaxInr: 20_000_000, assignedAgentId: "nba-agent" },
      { id: "nba-visit", organizationId: ORG, source: "MANUAL", score: 70, temperature: "WARM", status: "SITE_VISIT_SCHEDULED", budgetMaxInr: 4_000_000, assignedAgentId: "nba-other" },
    ]);
    await db.insert(conversations).values({ id: "nba-convo", organizationId: ORG, leadId: "nba-waiting", channel: "WEBSITE_CHAT", status: "AI_HANDLING" });
    await db.insert(messages).values({ conversationId: "nba-convo", sender: "LEAD", content: "hello?", createdAt: H(2) });
    await db.insert(appointments).values({ organizationId: ORG, leadId: "nba-visit", type: "SITE_VISIT", scheduledAt: FUT(20), status: "SCHEDULED" });
  });

  afterAll(wipe);

  it("surfaces RESPOND and CONFIRM actions from real rows", async () => {
    const res = await getOrganizationNextBestActions(ORG, { now: NOW });
    const byLead = new Map(res.actions.map((a) => [a.leadId, a]));
    expect(byLead.get("nba-waiting")?.action).toBe("RESPOND_TO_CUSTOMER");
    expect(byLead.get("nba-visit")?.action).toBe("CONFIRM_SITE_VISIT");
    for (const a of res.actions) {
      expect(a.reason.length).toBeGreaterThan(10);
      expect(["HIGH", "MEDIUM", "LOW"]).toContain(a.confidence);
    }
  });

  it("agents see only authorized leads; foreign org sees nothing", async () => {
    const own = await getOrganizationNextBestActions(ORG, { now: NOW, assignedAgentId: "nba-agent" });
    expect(own.actions.some((a) => a.leadId === "nba-waiting")).toBe(true);
    expect(own.actions.some((a) => a.leadId === "nba-visit")).toBe(false);
    const foreign = await getOrganizationNextBestActions("org-that-does-not-exist", { now: NOW });
    expect(foreign.actions).toEqual([]);
    expect(foreign.evaluated).toBe(0);
  });
});
