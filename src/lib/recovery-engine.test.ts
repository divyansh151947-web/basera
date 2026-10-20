import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  RECOVERY_COOLDOWN_DAYS,
  evaluateRecoveryDecision,
  type RecoveryContext,
} from "./recovery-engine";

function ctx(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    leadId: "lead-1",
    riskLevel: "HIGH",
    riskScore: 65,
    riskReasons: ["No customer reply in 3 days."],
    leadScore: 80,
    hasValue: true,
    status: "INTERESTED",
    lastInboundHoursAgo: 72,
    lastOutboundHoursAgo: 72,
    followUpOverdue: false,
    overdueFollowUpCount: 0,
    hasUpcomingAppointment: false,
    hasMissedVisit: false,
    handoffAwaitingHuman: false,
    channel: "WEBSITE_CHAT",
    pendingFollowUp: false,
    daysSinceLastAutoOutreach: null,
    openTaskExists: false,
    ...overrides,
  };
}

describe("recovery guards", () => {
  it("low-risk lead → no recovery", () => {
    const d = evaluateRecoveryDecision(ctx({ riskLevel: "LOW", riskScore: 10 }));
    expect(d.shouldRecover).toBe(false);
    expect(d.actionType).toBeNull();
  });

  it("closed lead → no recovery", () => {
    for (const status of ["CONVERTED", "LOST"]) {
      expect(evaluateRecoveryDecision(ctx({ status })).shouldRecover).toBe(false);
    }
  });

  it("opted-out lead → no recovery", () => {
    expect(evaluateRecoveryDecision(ctx({ optedOut: true })).shouldRecover).toBe(false);
  });

  it("upcoming appointment suppresses recovery", () => {
    const d = evaluateRecoveryDecision(ctx({ hasUpcomingAppointment: true }));
    expect(d.shouldRecover).toBe(false);
    expect(d.noActionReason).toMatch(/appointment/i);
  });
});

describe("spam protection", () => {
  it("recently contacted customer → no customer-facing action", () => {
    const d = evaluateRecoveryDecision(ctx({ lastInboundHoursAgo: 2, lastOutboundHoursAgo: 1 }));
    expect(d.shouldRecover).toBe(false);
    expect(d.actionType).toBeNull();
  });

  it("recent inbound with missing agent response → agent alert, not a send", () => {
    const d = evaluateRecoveryDecision(ctx({ lastInboundHoursAgo: 2, lastOutboundHoursAgo: null }));
    expect(d.shouldRecover).toBe(true);
    expect(d.actionType).toBe("AGENT_ALERT");
    expect(d.automation).toBe("ALERT");
  });

  it("pending follow-up blocks duplicate customer-facing actions", () => {
    const d = evaluateRecoveryDecision(ctx({ pendingFollowUp: true, followUpOverdue: true, overdueFollowUpCount: 1 }));
    expect(d.shouldRecover).toBe(false);
    expect(d.noActionReason).toMatch(/pending/i);
  });

  it("open agent task blocks new alerts", () => {
    const d = evaluateRecoveryDecision(ctx({ openTaskExists: true, lastInboundHoursAgo: 2, lastOutboundHoursAgo: null }));
    expect(d.shouldRecover).toBe(false);
  });

  it("recent auto outreach inside cooldown blocks repeats, with a cooldownUntil", () => {
    const d = evaluateRecoveryDecision(ctx({ daysSinceLastAutoOutreach: 1 }));
    expect(d.shouldRecover).toBe(false);
    expect(d.cooldownUntil).toBeTruthy();
  });
});

describe("rule selection and priority", () => {
  it("overdue follow-up on a quiet lead → AUTO follow-up", () => {
    const d = evaluateRecoveryDecision(ctx({ followUpOverdue: true, overdueFollowUpCount: 1 }));
    expect(d.shouldRecover).toBe(true);
    expect(d.actionType).toBe("FOLLOW_UP");
    expect(d.automation).toBe("AUTO");
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it("multiple overdue follow-ups → manager escalation", () => {
    const d = evaluateRecoveryDecision(ctx({ followUpOverdue: true, overdueFollowUpCount: 3 }));
    expect(d.actionType).toBe("MANAGER_ESCALATION");
    expect(d.automation).toBe("ALERT");
    expect(["P1", "P2"]).toContain(d.priority);
  });

  it("high-value high-risk lead gets top priority", () => {
    const p1 = evaluateRecoveryDecision(ctx({ riskLevel: "CRITICAL", followUpOverdue: true, overdueFollowUpCount: 1 }));
    expect(p1.priority).toBe("P1");
    const p2 = evaluateRecoveryDecision(ctx({ riskLevel: "HIGH", followUpOverdue: true, overdueFollowUpCount: 1 }));
    expect(p2.priority).toBe("P2");
  });

  it("missed visit → site-visit recovery prepared for approval, never auto-sent", () => {
    const d = evaluateRecoveryDecision(ctx({ hasMissedVisit: true }));
    expect(d.actionType).toBe("SITE_VISIT_RECOVERY");
    expect(d.automation).toBe("PREPARE");
  });

  it("unowned handoff → human handoff alert", () => {
    const d = evaluateRecoveryDecision(ctx({ handoffAwaitingHuman: true, assignedAgentId: null }));
    expect(d.actionType).toBe("HUMAN_HANDOFF");
    expect(d.automation).toBe("ALERT");
  });
});

describe("honest outputs", () => {
  it("decisions carry no revenue claims and document cooldowns", () => {
    const d = evaluateRecoveryDecision(ctx({ followUpOverdue: true, overdueFollowUpCount: 1 }));
    expect(JSON.stringify(d)).not.toMatch(/recovered|revenueAtRisk/i);
    expect(RECOVERY_COOLDOWN_DAYS.REACTIVATION).toBeGreaterThan(RECOVERY_COOLDOWN_DAYS.AGENT_ALERT);
  });

  it("high-risk stale valuable lead without follow-up issues reactivates", () => {
    const d = evaluateRecoveryDecision(ctx({ riskLevel: "HIGH", lastInboundHoursAgo: 100, lastOutboundHoursAgo: 100 }));
    expect(d.shouldRecover).toBe(true);
    expect(d.actionType).toBe("REACTIVATION");
  });
});
