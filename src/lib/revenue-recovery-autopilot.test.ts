import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import {
  appointments,
  auditLogs,
  conversations,
  leads,
  messages,
  organizations,
  tasks,
  users,
} from "@/db/schema";
import {
  AUTOPILOT_DISMISS_ACTION,
  AUTOPILOT_EXECUTE_ACTION,
  buildLostDealAnalysis,
  buildWonDealAnalysis,
  cooldownDaysForLeak,
  defaultNbaForLeak,
  deriveRecoveryState,
  detectLeaks,
  findRecentAutopilotAudits,
  getRecoveryAutopilot,
  getRecoveryTimeline,
  isRecoveryTaskTitle,
  opportunityValueFor,
  OUTCOME_NOT_YET_CONFIRMED_LABEL,
  recordAutopilotAudit,
  resolveAutopilotLeadId,
  scoreLeakPriority,
  type LeakSignal,
  type RecoveryStateInput,
} from "./revenue-recovery-autopilot";
import { RECOVERY_COOLDOWN_DAYS, evaluateRecoveryDecision } from "./recovery-engine";
import { recommendNextBestAction, type NbaInput } from "./next-best-action";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");

function signal(overrides: Partial<LeakSignal> = {}): LeakSignal {
  return {
    leadId: "lead-1",
    leadName: "Test Lead",
    status: "INTERESTED",
    optedOut: false,
    leadScore: 80,
    temperature: "HOT",
    siteVisitInterest: true,
    riskLevel: "HIGH",
    riskScore: 65,
    riskReasons: ["No customer reply in 3 days."],
    opportunityValue: 7_200_000,
    revenueAtRisk: 7_200_000,
    hasValue: true,
    lastInboundHoursAgo: 31,
    lastOutboundHoursAgo: 32,
    inboundCount: 2,
    leadAgeHoursAgo: 100,
    followUpOverdue: false,
    overdueFollowUpCount: 0,
    mostOverdueHoursAgo: null,
    pendingFollowUp: false,
    daysSinceLastAutoOutreach: null,
    openTaskExists: false,
    upcomingVisitInHours: null,
    upcomingVisitConfirmed: false,
    hasUpcomingAppointment: false,
    completedVisitWithoutFollowUp: false,
    hasAnyAppointment: false,
    hasStrongMatch: true,
    hasAnyInterest: true,
    qualifiedForVisit: true,
    handoffAwaitingHuman: false,
    assignedAgentId: "agent-1",
    channel: "WEBSITE_CHAT",
    ...overrides,
  };
}

describe("leak detection (deterministic, evidence-backed)", () => {
  it("1. high-intent unanswered lead is detected with factual evidence", () => {
    const leaks = detectLeaks(signal());
    const found = leaks.find((l) => l.type === "UNANSWERED_HIGH_INTENT");
    expect(found).toBeDefined();
    expect(found!.reason).toMatch(/1 day ago/);
    expect(found!.evidence.join(" ")).toMatch(/Last customer message/);
    expect(found!.evidence.join(" ")).toMatch(/Lead score/);
  });

  it("1b. answered or low-intent leads do not raise unanswered leaks", () => {
    expect(
      detectLeaks(signal({ lastOutboundHoursAgo: 30 })).some((l) => l.type === "UNANSWERED_HIGH_INTENT")
    ).toBe(false);
    expect(
      detectLeaks(
        signal({ leadScore: 20, temperature: "COLD", siteVisitInterest: false, riskLevel: "MEDIUM", riskScore: 30 })
      ).some((l) => l.type === "UNANSWERED_HIGH_INTENT")
    ).toBe(false);
  });

  it("2. overdue follow-up is detected from the schedule miss itself", () => {
    const leaks = detectLeaks(signal({ followUpOverdue: true, overdueFollowUpCount: 1, mostOverdueHoursAgo: 30 }));
    expect(leaks.some((l) => l.type === "FOLLOW_UP_OVERDUE")).toBe(true);
  });

  it("3. unconfirmed site visit inside the window is detected", () => {
    const leaks = detectLeaks(signal({ riskLevel: "LOW", riskScore: 10, upcomingVisitInHours: 20, upcomingVisitConfirmed: false }));
    expect(leaks.some((l) => l.type === "SITE_VISIT_NOT_CONFIRMED")).toBe(true);
    // Outside the window / confirmed → no leak.
    expect(
      detectLeaks(signal({ riskLevel: "LOW", riskScore: 10, upcomingVisitInHours: 100, upcomingVisitConfirmed: false })).some(
        (l) => l.type === "SITE_VISIT_NOT_CONFIRMED"
      )
    ).toBe(false);
    expect(
      detectLeaks(signal({ riskLevel: "LOW", riskScore: 10, upcomingVisitInHours: 20, upcomingVisitConfirmed: true })).some(
        (l) => l.type === "SITE_VISIT_NOT_CONFIRMED"
      )
    ).toBe(false);
  });

  it("4. completed visit with no follow-up contact is detected", () => {
    const leaks = detectLeaks(signal({ riskLevel: "LOW", riskScore: 5, completedVisitWithoutFollowUp: true }));
    expect(leaks.some((l) => l.type === "SITE_VISIT_NO_FOLLOW_UP")).toBe(true);
  });

  it("5. dormant high-value qualified lead is detected", () => {
    const leaks = detectLeaks(signal({ lastInboundHoursAgo: 20 * 24, lastOutboundHoursAgo: 20 * 24 }));
    expect(leaks.some((l) => l.type === "DORMANT_HIGH_VALUE")).toBe(true);
    // Recently active → not dormant.
    expect(
      detectLeaks(signal({ lastInboundHoursAgo: 31 })).some((l) => l.type === "DORMANT_HIGH_VALUE")
    ).toBe(false);
  });

  it("6. weak property match uses existing matching output, invents nothing", () => {
    const leaks = detectLeaks(signal({ hasAnyInterest: true, hasStrongMatch: false }));
    const found = leaks.find((l) => l.type === "PROPERTY_MISMATCH");
    expect(found).toBeDefined();
    expect(found!.reason).toMatch(/existing verified property-matching|weak/i);
    expect(
      detectLeaks(signal({ hasAnyInterest: true, hasStrongMatch: true })).some((l) => l.type === "PROPERTY_MISMATCH")
    ).toBe(false);
  });

  it("7. agent SLA breach fires only for assigned owners past the window", () => {
    expect(detectLeaks(signal()).some((l) => l.type === "AGENT_SLA_BREACH")).toBe(true);
    expect(
      detectLeaks(signal({ assignedAgentId: null })).some((l) => l.type === "AGENT_SLA_BREACH")
    ).toBe(false);
    expect(
      detectLeaks(signal({ lastInboundHoursAgo: 2, lastOutboundHoursAgo: null })).some(
        (l) => l.type === "AGENT_SLA_BREACH"
      )
    ).toBe(false);
  });

  it("8. high-risk fallback never inflates counts on top of real leaks", () => {
    const many = detectLeaks(signal());
    expect(many.some((l) => l.type === "HIGH_RISK_DEAL")).toBe(false);
    const bare = detectLeaks(
      signal({
        lastInboundHoursAgo: null,
        lastOutboundHoursAgo: null,
        followUpOverdue: false,
        siteVisitInterest: false,
        temperature: "WARM",
        leadScore: 50,
        riskLevel: "CRITICAL",
        riskScore: 90,
        assignedAgentId: null,
        hasAnyInterest: false,
      })
    );
    expect(bare).toHaveLength(1);
    expect(bare[0].type).toBe("HIGH_RISK_DEAL");
  });

  it("9. handoff surfaces instead of automating blindly", () => {
    const leaks = detectLeaks(signal({ handoffAwaitingHuman: true }));
    expect(leaks.some((l) => l.type === "HUMAN_HANDOFF_REQUIRED")).toBe(true);
  });

  it("closed / opted-out / LOW leads never leak (no fake categories)", () => {
    expect(detectLeaks(signal({ status: "LOST" }))).toEqual([]);
    expect(detectLeaks(signal({ status: "CONVERTED" }))).toEqual([]);
    expect(detectLeaks(signal({ optedOut: true }))).toEqual([]);
    // LOW risk with no row-factual signal → nothing.
    expect(
      detectLeaks(signal({ riskLevel: "LOW", riskScore: 8, lastInboundHoursAgo: 2, lastOutboundHoursAgo: 1 }))
    ).toEqual([]);
  });
});

describe("opportunity value (never invented)", () => {
  it("15. prefers verified midpoint, falls back to budget, else null", () => {
    expect(opportunityValueFor(7_500_000, 8_000_000)).toBe(7_500_000);
    expect(opportunityValueFor(null, 8_000_000)).toBe(8_000_000);
    expect(opportunityValueFor(null, null)).toBeNull();
    expect(opportunityValueFor(0, -5)).toBeNull();
    expect(opportunityValueFor(undefined, undefined)).toBeNull();
  });
});

describe("priority (urgency first, explainable, money never dominates)", () => {
  it("8b. severe SLA breach on a smaller deal outranks dormant larger deal", () => {
    const slaBreach = scoreLeakPriority(
      signal({ opportunityValue: 3_000_000, lastInboundHoursAgo: 80 }),
      "AGENT_SLA_BREACH"
    );
    const dormantRich = scoreLeakPriority(
      signal({ opportunityValue: 50_000_000, lastInboundHoursAgo: 20 * 24, lastOutboundHoursAgo: 20 * 24 }),
      "DORMANT_HIGH_VALUE"
    );
    expect(slaBreach.score).toBeGreaterThan(dormantRich.score);
  });

  it("every priority point is named in the breakdown", () => {
    const { score, breakdown } = scoreLeakPriority(signal(), "UNANSWERED_HIGH_INTENT");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(breakdown.length).toBeGreaterThan(0);
    expect(breakdown.join(" ")).toMatch(/Base risk contribution/);
  });
});

describe("next-best recovery action mapping (consumes NBA, never replaces)", () => {
  it("9b. each leak has a sensible NBA default", () => {
    expect(defaultNbaForLeak("UNANSWERED_HIGH_INTENT")).toBe("RESPOND_TO_CUSTOMER");
    expect(defaultNbaForLeak("FOLLOW_UP_OVERDUE")).toBe("FOLLOW_UP");
    expect(defaultNbaForLeak("SITE_VISIT_NOT_CONFIRMED")).toBe("CONFIRM_SITE_VISIT");
    expect(defaultNbaForLeak("SITE_VISIT_NO_FOLLOW_UP")).toBe("FOLLOW_UP_AFTER_SITE_VISIT");
    expect(defaultNbaForLeak("DORMANT_HIGH_VALUE")).toBe("REACTIVATE_LEAD");
    expect(defaultNbaForLeak("PROPERTY_MISMATCH")).toBe("FIND_BETTER_PROPERTY");
    expect(defaultNbaForLeak("HUMAN_HANDOFF_REQUIRED")).toBe("HANDOFF_TO_HUMAN");
    expect(defaultNbaForLeak("HIGH_RISK_DEAL")).toBe("ESCALATE_TO_MANAGER");
  });
});

describe("cooldowns reuse the recovery engine table (no competing semantics)", () => {
  it("10. leak cooldowns equal the engine cooldowns per action family", () => {
    expect(cooldownDaysForLeak("FOLLOW_UP_OVERDUE")).toBe(RECOVERY_COOLDOWN_DAYS.FOLLOW_UP);
    expect(cooldownDaysForLeak("DORMANT_HIGH_VALUE")).toBe(RECOVERY_COOLDOWN_DAYS.REACTIVATION);
    expect(cooldownDaysForLeak("SITE_VISIT_NOT_CONFIRMED")).toBe(RECOVERY_COOLDOWN_DAYS.SITE_VISIT_RECOVERY);
    expect(cooldownDaysForLeak("SITE_VISIT_NO_FOLLOW_UP")).toBe(RECOVERY_COOLDOWN_DAYS.SITE_VISIT_RECOVERY);
    expect(cooldownDaysForLeak("HIGH_RISK_DEAL")).toBe(RECOVERY_COOLDOWN_DAYS.MANAGER_ESCALATION);
    expect(cooldownDaysForLeak("HUMAN_HANDOFF_REQUIRED")).toBe(RECOVERY_COOLDOWN_DAYS.HUMAN_HANDOFF);
    expect(cooldownDaysForLeak("UNANSWERED_HIGH_INTENT")).toBe(RECOVERY_COOLDOWN_DAYS.AGENT_ALERT);
    expect(cooldownDaysForLeak("AGENT_SLA_BREACH")).toBe(RECOVERY_COOLDOWN_DAYS.AGENT_ALERT);
    expect(cooldownDaysForLeak("PROPERTY_MISMATCH")).toBe(RECOVERY_COOLDOWN_DAYS.AGENT_ALERT);
  });
});

describe("11. deterministic action ids (idempotency key material)", () => {
  it("composite ids resolve to the lead id on both forms", () => {
    expect(resolveAutopilotLeadId("lead-abc:UNANSWERED_HIGH_INTENT")).toBe("lead-abc");
    expect(resolveAutopilotLeadId("lead-abc")).toBe("lead-abc");
  });

  it("recovery task titles are recognized as attempts", () => {
    expect(isRecoveryTaskTitle("Recover at-risk lead (P1)")).toBe(true);
    expect(isRecoveryTaskTitle("Escalated at-risk lead (P2)")).toBe(true);
    expect(isRecoveryTaskTitle("Weekly team sync")).toBe(false);
    expect(isRecoveryTaskTitle(null)).toBe(false);
  });
});

describe("19/20. lost/won analyses use factual, non-causal wording", () => {
  const facts = {
    leadId: "deal-1",
    leadName: "Dealer",
    leadScore: 78,
    associatedValue: 7_500_000,
    interestCount: 2,
    hasStrongMatch: false,
    siteVisitInterest: true,
    completedVisits: 0,
    missedVisits: 0,
    overdueFollowUpCount: 2,
    maxResponseDelayHours: 30,
    inactiveDays: 12,
    hadUpcomingAtClose: false,
  };

  it("19. lost deals say observed / potential contributing factor, never caused", () => {
    const analysis = buildLostDealAnalysis({ ...facts, status: "LOST" });
    expect(analysis.status).toBe("LOST");
    expect(analysis.honestyNote).toMatch(/Based on recorded activity/);
    expect(analysis.potentialContributingFactors.length).toBeGreaterThan(0);
    expect(analysis.potentialContributingFactors.join(" ")).toMatch(/Potential contributing factor/);
    const all = JSON.stringify(analysis).toLowerCase();
    expect(all).not.toMatch(/caused|causal|proof|proves/);
  });

  it("20. won deals record conversion signals from facts only", () => {
    const analysis = buildWonDealAnalysis({
      ...facts,
      status: "CONVERTED",
      completedVisits: 1,
      overdueFollowUpCount: 0,
      maxResponseDelayHours: 4,
    });
    expect(analysis.status).toBe("CONVERTED");
    expect(analysis.conversionSignals.join(" ")).toMatch(/based on recorded activity/i);
    // No revenue claim anywhere: no such key, and the value wording
    // explicitly denies payment evidence.
    expect("recoveredRevenue" in analysis).toBe(false);
    expect("revenueRecovered" in analysis).toBe(false);
    expect(JSON.stringify(analysis)).not.toMatch(/revenue (was |has been )?recovered/i);
    expect(analysis.honestyNote).toMatch(/not proven causes/);
  });
});

describe("freeze guards: autopilot introduces no AI/WhatsApp/email sends", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const libSrc = readFileSync(resolve(here, "revenue-recovery-autopilot.ts"), "utf8");
  const executeSrc = readFileSync(
    resolve(here, "..", "app", "api", "revenue", "recovery", "actions", "[id]", "execute", "route.ts"),
    "utf8"
  );

  it("21. autopilot lib never touches WhatsApp/email/AI providers", () => {
    expect(libSrc).not.toMatch(/whatsapp/i);
    expect(libSrc).not.toMatch(/from ["']@\/lib\/email/i);
    expect(libSrc).not.toMatch(/ai-provider|conversation-agent|claude|openai/i);
    expect(libSrc).not.toMatch(/addMessage|sendMessage|deliver/i);
  });

  it("21b. execute route sends nothing directly — only the existing engine", () => {
    expect(executeSrc).not.toMatch(/whatsapp/i);
    expect(executeSrc).not.toMatch(/addMessage/);
    expect(executeSrc).toMatch(/executeRecoveryAction/);
  });
});

// ---------------------------------------------------------------------------
// DB-backed integration: sweep, scoping, outcomes, timeline, audit markers
// ---------------------------------------------------------------------------

const ORG = "autopilot-test-org";
const OTHER_ORG = "autopilot-other-org";
const isoHoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const isoHoursAhead = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

async function wipe() {
  await db.delete(tasks).where(eq(tasks.organizationId, ORG));
  await db.delete(auditLogs).where(eq(auditLogs.organizationId, ORG));
  await db.delete(messages).where(eq(messages.conversationId, "ap-convo-unanswered"));
  await db.delete(messages).where(eq(messages.conversationId, "ap-convo-overdue"));
  await db.delete(messages).where(eq(messages.conversationId, "ap-convo-visit"));
  await db.delete(messages).where(eq(messages.conversationId, "ap-convo-dormant"));
  await db.delete(appointments).where(eq(appointments.organizationId, ORG));
  await db.delete(conversations).where(eq(conversations.organizationId, ORG));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
  await db.delete(organizations).where(eq(organizations.id, OTHER_ORG));
}

describe("autopilot sweep, scoping, outcomes, timeline", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values([
      { id: ORG, name: "Autopilot Test", slug: `autopilot-test-${Date.now()}` },
      { id: OTHER_ORG, name: "Autopilot Other", slug: `autopilot-other-${Date.now()}` },
    ]);
    const pw = await bcrypt.hash("x", 4);
    await db.insert(users).values([
      { id: "ap-manager", organizationId: ORG, name: "AP Manager", email: "ap-manager@example.com", passwordHash: pw, role: "MANAGER" },
      { id: "ap-agent-a", organizationId: ORG, name: "AP Agent A", email: "ap-agent-a@example.com", passwordHash: pw, role: "SALES_AGENT" },
      { id: "ap-agent-b", organizationId: ORG, name: "AP Agent B", email: "ap-agent-b@example.com", passwordHash: pw, role: "SALES_AGENT" },
    ]);

    // Unanswered high-intent: HOT, site-visit interest, ₹72L budget,
    // customer wrote 31h ago, no agent response, owned by agent-a.
    await db.insert(leads).values({
      id: "ap-unanswered",
      organizationId: ORG,
      name: "Rajesh",
      source: "WHATSAPP",
      score: 85,
      temperature: "HOT",
      status: "INTERESTED",
      budgetMaxInr: 7_200_000,
      siteVisitInterest: true,
      assignedAgentId: "ap-agent-a",
      nextFollowUpAt: isoHoursAgo(31),
    });
    await db.insert(conversations).values({ id: "ap-convo-unanswered", organizationId: ORG, leadId: "ap-unanswered", channel: "WHATSAPP", status: "AI_HANDLING" });
    await db.insert(messages).values({ conversationId: "ap-convo-unanswered", sender: "LEAD", content: "Is the site visit still possible this weekend?", createdAt: isoHoursAgo(31) });

    // Overdue follow-up, owned by agent-a, conversation otherwise answered.
    await db.insert(leads).values({
      id: "ap-overdue",
      organizationId: ORG,
      name: "Priya",
      source: "WEBSITE_CHAT",
      score: 65,
      temperature: "WARM",
      status: "QUALIFIED",
      budgetMaxInr: 5_000_000,
      assignedAgentId: "ap-agent-a",
      nextFollowUpAt: isoHoursAgo(5),
    });
    await db.insert(conversations).values({ id: "ap-convo-overdue", organizationId: ORG, leadId: "ap-overdue", channel: "WEBSITE_CHAT", status: "AI_HANDLING" });
    await db.insert(messages).values([
      { conversationId: "ap-convo-overdue", sender: "LEAD", content: "Please share the floor plan", createdAt: isoHoursAgo(60) },
      { conversationId: "ap-convo-overdue", sender: "AGENT", content: "Sharing it shortly", createdAt: isoHoursAgo(59) },
    ]);

    // Unconfirmed visit tomorrow (owned by agent-a). Fresh engagement keeps
    // risk LOW — the visit leak must still surface (row-factual).
    await db.insert(leads).values({
      id: "ap-visit",
      organizationId: ORG,
      name: "Amit",
      source: "WEBSITE_CHAT",
      score: 70,
      temperature: "WARM",
      status: "QUALIFIED",
      budgetMaxInr: 8_000_000,
      assignedAgentId: "ap-agent-a",
    });
    await db.insert(conversations).values({ id: "ap-convo-visit", organizationId: ORG, leadId: "ap-visit", channel: "WEBSITE_CHAT", status: "AI_HANDLING" });
    await db.insert(messages).values([
      { conversationId: "ap-convo-visit", sender: "LEAD", content: "Tomorrow 11am works for me", createdAt: isoHoursAgo(10) },
      { conversationId: "ap-convo-visit", sender: "AGENT", content: "Blocked the slot, see you then", createdAt: isoHoursAgo(9) },
    ]);
    await db.insert(appointments).values({
      organizationId: ORG,
      leadId: "ap-visit",
      agentId: "ap-agent-a",
      type: "SITE_VISIT",
      scheduledAt: isoHoursAhead(20),
      status: "SCHEDULED",
    });

    // Dormant high-value (owned by agent-a): qualified, ₹65L, quiet 20 days.
    await db.insert(leads).values({
      id: "ap-dormant",
      organizationId: ORG,
      name: "Sunita",
      source: "WEBSITE_FORM",
      score: 72,
      temperature: "WARM",
      status: "QUALIFIED",
      budgetMaxInr: 6_500_000,
      assignedAgentId: "ap-agent-a",
    });
    await db.insert(conversations).values({ id: "ap-convo-dormant", organizationId: ORG, leadId: "ap-dormant", channel: "WEBSITE_CHAT", status: "AI_HANDLING" });
    await db.insert(messages).values({ conversationId: "ap-convo-dormant", sender: "LEAD", content: "Interested in 3BHK options", createdAt: isoHoursAgo(20 * 24) });

    // Colleague's risky lead (agent-b) — agent-a must never see it.
    await db.insert(leads).values({
      id: "ap-other-agent",
      organizationId: ORG,
      name: "Farhan",
      source: "MANUAL",
      score: 88,
      temperature: "HOT",
      status: "NEGOTIATION",
      budgetMaxInr: 9_000_000,
      assignedAgentId: "ap-agent-b",
      nextFollowUpAt: isoHoursAgo(50),
    });

    // Lost deal with value on file (agent-a) for the lost-deal framework.
    await db.insert(leads).values({
      id: "ap-lost",
      organizationId: ORG,
      name: "Kavya",
      source: "MANUAL",
      score: 70,
      temperature: "WARM",
      status: "LOST",
      budgetMaxInr: 7_500_000,
      assignedAgentId: "ap-agent-a",
    });
  });

  afterAll(wipe);

  it("detects the seeded leaks with explanations and NBA actions", async () => {
    const auto = await getRecoveryAutopilot(ORG, { now: NOW });
    const types = new Map(auto.leaks.map((l) => [l.leadId + ":" + l.type, l]));
    expect(types.get("ap-unanswered:UNANSWERED_HIGH_INTENT")).toBeDefined();
    expect(types.get("ap-overdue:FOLLOW_UP_OVERDUE")).toBeDefined();
    expect(types.get("ap-visit:SITE_VISIT_NOT_CONFIRMED")).toBeDefined();
    expect(types.get("ap-dormant:DORMANT_HIGH_VALUE")).toBeDefined();

    const unanswered = types.get("ap-unanswered:UNANSWERED_HIGH_INTENT")!;
    expect(unanswered.reason.length).toBeGreaterThan(0);
    expect(unanswered.evidence.length).toBeGreaterThan(0);
    expect(unanswered.recommendedAction).toBe("RESPOND_TO_CUSTOMER");
    expect(unanswered.opportunityValue).toBe(7_200_000);
    expect(unanswered.hoursSinceLastAction).not.toBeNull();
  });

  it("15/16. recovered revenue is never fabricated; attempt is not revenue", async () => {
    const auto = await getRecoveryAutopilot(ORG, { now: NOW });
    expect(auto.overview.recoveredRevenue).toBeNull();
    expect(JSON.stringify(auto)).not.toMatch(/recoveredRevenue":\s*[0-9]/);
    expect(auto.overview.honestyNote).toMatch(/does not record/i);
  });

  it("13/14. agent sees own + unassigned only; manager sees all", async () => {
    const agentA = await getRecoveryAutopilot(ORG, { now: NOW, assignedAgentId: "ap-agent-a" });
    const agentALeads = new Set(agentA.leaks.map((l) => l.leadId));
    expect(agentALeads.has("ap-other-agent")).toBe(false);
    expect(agentALeads.has("ap-unanswered")).toBe(true);

    const agentB = await getRecoveryAutopilot(ORG, { now: NOW, assignedAgentId: "ap-agent-b" });
    expect(new Set(agentB.leaks.map((l) => l.leadId)).has("ap-unanswered")).toBe(false);

    const manager = await getRecoveryAutopilot(ORG, { now: NOW });
    expect(new Set(manager.leaks.map((l) => l.leadId)).has("ap-other-agent")).toBe(true);
  });

  it("12. tenant isolation: foreign org sees nothing", async () => {
    const foreign = await getRecoveryAutopilot(OTHER_ORG, { now: NOW });
    expect(foreign.leaks).toEqual([]);
    expect(foreign.outcomes).toEqual([]);
    expect(foreign.overview.revenueAtRisk).toBe(0);
    expect(foreign.overview.recoveredRevenue).toBeNull();
  });

  it("17. outcome tracking: response after a recovery attempt is a success, not revenue", async () => {
    // Explicit timestamps keep this deterministic regardless of wall-clock:
    // recovery task at T-2h, customer response at T-30m (after the attempt).
    await db.insert(tasks).values({
      organizationId: ORG,
      leadId: "ap-unanswered",
      assigneeId: "ap-agent-a",
      title: "Recover at-risk lead (P1)",
      createdAt: isoHoursAgo(2),
    });
    // Customer responds AFTER the recovery task was created (now > task).
    await db.insert(messages).values({
      conversationId: "ap-convo-unanswered",
      sender: "LEAD",
      content: "Yes, Saturday works for the visit",
      createdAt: new Date(NOW - 30 * 60_000).toISOString(),
    });
    const auto = await getRecoveryAutopilot(ORG, { now: NOW });
    const outcome = auto.outcomes.find((o) => o.leadId === "ap-unanswered");
    expect(outcome).toBeDefined();
    expect(outcome!.attempts).toBeGreaterThanOrEqual(1);
    expect(outcome!.customerRespondedAfterAttempt).toBe(true);
    expect(outcome!.positiveOutcome).toBe(true);
    expect(outcome!.revenueNote).toMatch(/not recovered revenue/i);
    expect(auto.overview.recoveredRevenue).toBeNull();
  });

  it("18. timeline uses recorded rows only, in order, with an honesty note", async () => {
    const timeline = await getRecoveryTimeline(ORG, "ap-unanswered");
    expect(timeline).not.toBeNull();
    expect(timeline!.honestyNote).toMatch(/recorded rows only/i);
    const kinds = timeline!.events.map((e) => e.kind);
    expect(kinds).toContain("LEAD_CREATED");
    expect(kinds).toContain("MESSAGE_INBOUND");
    expect(kinds).toContain("RECOVERY_TASK");
    const times = timeline!.events.map((e) => new Date(e.at).getTime());
    expect(times.every((t) => Number.isFinite(t))).toBe(true);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    // Tenant-scoped: unknown org / unknown lead → null.
    expect(await getRecoveryTimeline(OTHER_ORG, "ap-unanswered")).toBeNull();
    expect(await getRecoveryTimeline(ORG, "lead-that-does-not-exist")).toBeNull();
  });

  it("dismiss and execute audits round-trip and suppress duplicates", async () => {
    await recordAutopilotAudit(ORG, "ap-manager", AUTOPILOT_DISMISS_ACTION, "ap-dormant", {
      leakType: "DORMANT_HIGH_VALUE",
      summary: "test dismissal",
    });
    const suppressed = await getRecoveryAutopilot(ORG, { now: NOW });
    expect(
      suppressed.leaks.filter((l) => l.leadId === "ap-dormant").every((l) => l.recoveryStatus === "DISMISSED")
    ).toBe(true);

    await recordAutopilotAudit(ORG, "ap-manager", AUTOPILOT_EXECUTE_ACTION, "ap-overdue", {
      leakType: "FOLLOW_UP_OVERDUE",
      summary: "test execution",
    });
    const recent = await findRecentAutopilotAudits(
      ORG,
      AUTOPILOT_EXECUTE_ACTION,
      new Date(NOW - 24 * 3_600_000).toISOString()
    );
    expect(recent.some((a) => a.entityId === "ap-overdue")).toBe(true);
    // Foreign org audit trail is invisible here (tenant-scoped reads).
    const foreignRecent = await findRecentAutopilotAudits(
      OTHER_ORG,
      AUTOPILOT_EXECUTE_ACTION,
      new Date(NOW - 24 * 3_600_000).toISOString()
    );
    expect(foreignRecent.some((a) => a.entityId === "ap-overdue")).toBe(false);
  });

  it("lost-deal framework appears in the sweep with factual wording", async () => {
    const auto = await getRecoveryAutopilot(ORG, { now: NOW });
    const lost = auto.lostDeals.find((d) => d.leadId === "ap-lost");
    expect(lost).toBeDefined();
    expect(lost!.associatedValue).toBe(7_500_000);
    expect(lost!.observed.join(" ")).toMatch(/₹/);
    expect(lost!.potentialContributingFactors.join(" ")).toMatch(/Potential contributing factor|not on record/);
    expect(lost!.honestyNote).toMatch(/Based on recorded activity/);
  });

  it("existing engines still agree: at-risk totals match between sweep and engine", async () => {
    const { getOrganizationRevenueRisk } = await import("./revenue-at-risk");
    const auto = await getRecoveryAutopilot(ORG, { now: NOW });
    const risk = await getOrganizationRevenueRisk(ORG, { now: NOW, topLimit: 200 });
    expect(auto.overview.revenueAtRisk).toBe(risk.totalRevenueAtRisk);
  });

  it("12b. extended outcome metrics stay honest (no revenue figure anywhere)", async () => {
    // Won lead WITH recovery activity: CONVERTED + staged recovery task.
    await db.insert(leads).values({
      id: "ap-won",
      organizationId: ORG,
      name: "Dev",
      source: "MANUAL",
      score: 82,
      temperature: "HOT",
      status: "CONVERTED",
      budgetMaxInr: 9_500_000,
      assignedAgentId: "ap-agent-a",
    });
    await db.insert(tasks).values({
      organizationId: ORG,
      leadId: "ap-won",
      assigneeId: "ap-agent-a",
      title: "Recover at-risk lead (P1)",
      createdAt: isoHoursAgo(50),
    });
    const auto = await getRecoveryAutopilot(ORG, { now: NOW });
    expect(auto.overview.dealsWonWithActivity).toBe(1);
    expect(auto.wonDeals.some((d) => d.leadId === "ap-won")).toBe(true);
    // ap-unanswered (task + later inbound from test 17) confirms a response.
    const outcome = auto.outcomes.find((o) => o.leadId === "ap-unanswered");
    expect(outcome?.confirmationStatus).toBe("CONFIRMED_RESPONSE");
    expect(outcome?.recoveryState).toBe("CUSTOMER_RESPONDED");
    expect(outcome?.confirmationLabel).toMatch(/Confirmed: customer responded/);
    expect(auto.overview.recoveryResponses).toBeGreaterThanOrEqual(1);
    // ap-overdue has attempts on record but no post-attempt response yet.
    const pending = auto.outcomes.find((o) => o.leadId === "ap-overdue");
    if (pending && !pending.positiveOutcome) {
      expect(pending.confirmationStatus).toBe("OUTCOME_NOT_YET_CONFIRMED");
      expect(pending.confirmationLabel).toBe(OUTCOME_NOT_YET_CONFIRMED_LABEL);
    }
    expect(auto.overview.recoveredRevenue).toBeNull();
  });
});

describe("11. recovery states (evidence-gated, never inferred)", () => {
  const base: RecoveryStateInput = {
    currentStatus: "INTERESTED",
    hasAnyLeak: false,
    hasActionNeededLeak: false,
    recoveryTasksStaged: 0,
    executeAuditExists: false,
    sentFollowUps: 0,
    customerRespondedAfterAttempt: false,
    siteVisitBookedAfterAttempt: false,
    visitCompletedAfterAttempt: false,
  };

  it("detected → recommended → prepared → executed ladder", () => {
    // NEW status: no advanced-stage DEAL_PROGRESS shortcut interferes.
    const fresh = { ...base, currentStatus: "NEW" };
    expect(deriveRecoveryState({ ...fresh, hasAnyLeak: true }).state).toBe("OPPORTUNITY_DETECTED");
    expect(
      deriveRecoveryState({ ...fresh, hasAnyLeak: true, hasActionNeededLeak: true }).state
    ).toBe("ACTION_RECOMMENDED");
    expect(deriveRecoveryState({ ...fresh, hasAnyLeak: true, recoveryTasksStaged: 1 }).state).toBe(
      "ACTION_PREPARED"
    );
    expect(
      deriveRecoveryState({ ...fresh, hasAnyLeak: true, recoveryTasksStaged: 1, executeAuditExists: true }).state
    ).toBe("ACTION_EXECUTED");
    expect(deriveRecoveryState({ ...fresh, sentFollowUps: 2 }).state).toBe("ACTION_EXECUTED");
  });

  it("post-attempt milestones in precedence order, without causal claims", () => {
    const attempted = { ...base, hasAnyLeak: true, recoveryTasksStaged: 1, executeAuditExists: true };
    expect(deriveRecoveryState({ ...attempted, customerRespondedAfterAttempt: true }).state).toBe(
      "CUSTOMER_RESPONDED"
    );
    expect(
      deriveRecoveryState({ ...attempted, customerRespondedAfterAttempt: true, siteVisitBookedAfterAttempt: true })
        .state
    ).toBe("SITE_VISIT_BOOKED");
    expect(
      deriveRecoveryState({
        ...attempted,
        customerRespondedAfterAttempt: true,
        siteVisitBookedAfterAttempt: true,
        visitCompletedAfterAttempt: true,
      }).state
    ).toBe("SITE_VISIT_COMPLETED");
    const responded = deriveRecoveryState({ ...attempted, customerRespondedAfterAttempt: true });
    expect(responded.stateEvidence).toMatch(/not proof the recovery caused the reply/);
  });

  it("deal progress needs an attempt plus an advanced stage; won/lost need status", () => {
    expect(
      deriveRecoveryState({ ...base, recoveryTasksStaged: 1, currentStatus: "NEGOTIATION" }).state
    ).toBe("DEAL_PROGRESS");
    expect(deriveRecoveryState({ ...base, recoveryTasksStaged: 1, currentStatus: "NEW" }).state).toBe(
      "ACTION_PREPARED"
    );
    expect(deriveRecoveryState({ ...base, currentStatus: "CONVERTED" }).state).toBe("DEAL_WON");
    expect(deriveRecoveryState({ ...base, currentStatus: "LOST" }).state).toBe("DEAL_LOST");
    // Terminal status wins over milestones (status is the recorded fact).
    expect(
      deriveRecoveryState({ ...base, currentStatus: "CONVERTED", customerRespondedAfterAttempt: true }).state
    ).toBe("DEAL_WON");
  });
});

describe("6/15/16. NBA integration contracts the autopilot consumes", () => {
  function nbaInput(overrides: Partial<NbaInput> = {}): NbaInput {
    return {
      leadId: "lead-1",
      leadName: "Test",
      status: "INTERESTED",
      optedOut: false,
      leadScore: 75,
      riskLevel: "HIGH",
      riskScore: 60,
      riskReasons: ["Stalled."],
      revenueAtRisk: 5_000_000,
      hasValue: true,
      lastInboundHoursAgo: 30,
      lastOutboundHoursAgo: 31,
      followUpOverdue: false,
      overdueFollowUpCount: 0,
      pendingFollowUp: false,
      daysSinceLastAutoOutreach: null,
      openTaskExists: false,
      upcomingVisitInHours: null,
      upcomingVisitConfirmed: false,
      completedVisitWithoutFollowUp: false,
      hasAnyAppointment: false,
      siteVisitInterest: false,
      qualifiedForVisit: true,
      hasStrongMatch: true,
      hasAnyInterest: false,
      handoffAwaitingHuman: false,
      assignedAgentId: "agent-1",
      channel: "WEBSITE_CHAT",
      recoveryAction: "FOLLOW_UP",
      recoveryShouldAct: true,
      ...overrides,
    };
  }

  it("15. completed visit + silence recommends FOLLOW_UP_AFTER_SITE_VISIT", () => {
    // Thread is answered (outbound newer than inbound) so the unanswered-
    // inbound rule does not preempt the post-visit rule.
    const r = recommendNextBestAction(
      nbaInput({ completedVisitWithoutFollowUp: true, lastOutboundHoursAgo: 20 }),
      NOW
    );
    expect(r.action).toBe("FOLLOW_UP_AFTER_SITE_VISIT");
  });

  it("16. dormant high-value lead recommends REACTIVATE_LEAD", () => {
    const r = recommendNextBestAction(
      nbaInput({ lastInboundHoursAgo: 20 * 24, lastOutboundHoursAgo: 20 * 24, recoveryShouldAct: false, recoveryAction: null }),
      NOW
    );
    expect(r.action).toBe("REACTIVATE_LEAD");
  });

  it("6b. WAIT_AND_MONITOR / NO_ACTION from NBA is respected, never forced", () => {
    const r = recommendNextBestAction(
      nbaInput({ riskLevel: "LOW", riskScore: 5, recoveryShouldAct: false, recoveryAction: null, lastOutboundHoursAgo: 20 }),
      NOW
    );
    expect(["WAIT_AND_MONITOR", "NO_ACTION"]).toContain(r.action);
  });

  it("11b. unowned handoff yields an ALERT, never autonomous sends", () => {
    const d = evaluateRecoveryDecision(
      {
        leadId: "lead-1",
        riskLevel: "HIGH",
        riskScore: 65,
        riskReasons: ["Waiting."],
        leadScore: 80,
        hasValue: true,
        status: "INTERESTED",
        lastInboundHoursAgo: 30,
        lastOutboundHoursAgo: null,
        followUpOverdue: false,
        overdueFollowUpCount: 0,
        hasUpcomingAppointment: false,
        hasMissedVisit: false,
        handoffAwaitingHuman: true,
        assignedAgentId: null,
        channel: "WEBSITE_CHAT",
        pendingFollowUp: false,
        daysSinceLastAutoOutreach: null,
        openTaskExists: false,
      },
      NOW
    );
    expect(d.actionType).toBe("HUMAN_HANDOFF");
    expect(d.automation).toBe("ALERT");
    expect(d.automation).not.toBe("AUTO");
  });
});

describe("9. execute route is authorization-checked (regression guard)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const executeSrc = readFileSync(
    resolve(here, "..", "app", "api", "revenue", "recovery", "actions", "[id]", "execute", "route.ts"),
    "utf8"
  );
  const dismissSrc = readFileSync(
    resolve(here, "..", "app", "api", "revenue", "recovery", "actions", "[id]", "dismiss", "route.ts"),
    "utf8"
  );

  it("both action routes scope the lead to the tenant and check assignment", () => {
    for (const src of [executeSrc, dismissSrc]) {
      expect(src).toMatch(/requireTenant/);
      expect(src).toMatch(/getLeadById\(organizationId/);
      expect(src).toMatch(/requireLeadAccess\(role, userId, lead\)/);
      expect(src).not.toMatch(/organizationId.*req\.json|body\.organizationId/i);
    }
  });
});
