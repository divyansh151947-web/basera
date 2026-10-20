import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import {
  appointments,
  conversations,
  followUps,
  leads,
  messages,
  notifications,
  organizations,
  tasks,
  users,
} from "@/db/schema";
import {
  evaluateSingleLeadRecovery,
  executeRecoveryAction,
  getOrganizationRecoveryCandidates,
} from "./recovery-engine";

const ORG = "rec-test-org";
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const isoHoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

async function wipe() {
  await db.delete(tasks).where(eq(tasks.organizationId, ORG));
  await db.delete(notifications).where(eq(notifications.organizationId, ORG));
  await db.delete(messages).where(eq(messages.conversationId, "rec-convo"));
  await db.delete(followUps).where(eq(followUps.organizationId, ORG));
  await db.delete(appointments).where(eq(appointments.organizationId, ORG));
  await db.delete(conversations).where(eq(conversations.organizationId, ORG));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
}

describe("recovery candidates respect tenant and assignment scope", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values({ id: ORG, name: "Recovery Test", slug: `rec-test-${Date.now()}` });
    const pw = await bcrypt.hash("x", 4);
    await db.insert(users).values([
      { id: "rec-manager", organizationId: ORG, name: "Rec Manager", email: "rec-manager@example.com", passwordHash: pw, role: "MANAGER" },
      { id: "rec-agent-a", organizationId: ORG, name: "Rec Agent A", email: "rec-agent-a@example.com", passwordHash: pw, role: "SALES_AGENT" },
      { id: "rec-agent-b", organizationId: ORG, name: "Rec Agent B", email: "rec-agent-b@example.com", passwordHash: pw, role: "SALES_AGENT" },
    ]);
    await db.insert(leads).values({
      id: "rec-risky",
      organizationId: ORG,
      source: "MANUAL",
      score: 84,
      temperature: "HOT",
      status: "INTERESTED",
      budgetMaxInr: 8_500_000,
      assignedAgentId: "rec-agent-a",
      nextFollowUpAt: isoHoursAgo(5),
    });
    await db.insert(conversations).values({ id: "rec-convo", organizationId: ORG, leadId: "rec-risky", channel: "WEBSITE_CHAT", status: "AI_HANDLING" });
    await db.insert(messages).values({ conversationId: "rec-convo", sender: "LEAD", content: "still there?", createdAt: isoHoursAgo(60) });
    // NOTE: no PENDING follow-up row here on purpose — the overdue signal
    // comes from the lead's nextFollowUpAt column. A pending row would mean
    // in-flight work and must suppress duplicates (tested separately).
  });

  afterAll(wipe);

  it("finds the overdue candidate for managers", async () => {
    const res = await getOrganizationRecoveryCandidates(ORG, { now: NOW });
    expect(res.evaluated).toBeGreaterThanOrEqual(1);
    const found = res.candidates.find((c) => c.leadId === "rec-risky");
    expect(found).toBeDefined();
    expect(found?.decision.shouldRecover).toBe(true);
    expect(found?.decision.actionType).toBe("FOLLOW_UP");
  });

  it("agent sees only authorized candidates; foreign org sees none", async () => {
    const own = await getOrganizationRecoveryCandidates(ORG, { now: NOW, assignedAgentId: "rec-agent-a" });
    expect(own.candidates.some((c) => c.leadId === "rec-risky")).toBe(true);
    const other = await getOrganizationRecoveryCandidates(ORG, { now: NOW, assignedAgentId: "rec-agent-b" });
    expect(other.candidates.some((c) => c.leadId === "rec-risky")).toBe(false);
    const foreign = await getOrganizationRecoveryCandidates("org-that-does-not-exist", { now: NOW });
    expect(foreign.candidates).toEqual([]);
    expect(foreign.evaluated).toBe(0);
  });

  it("executing a FOLLOW_UP schedules via existing infra and claims no revenue", async () => {
    const evaluated = await evaluateSingleLeadRecovery(ORG, "rec-risky", NOW);
    expect(evaluated?.decision.actionType).toBe("FOLLOW_UP");
    const result = await executeRecoveryAction(ORG, "rec-risky", evaluated!.decision, { assignedAgentId: "rec-agent-a" });
    expect(result.attempted).toBe(true);
    expect(result.recordKind).toBe("followUp");
    expect(JSON.stringify(result)).not.toMatch(/recovered|revenueAtRisk|₹/i);
    const rows = await db.select().from(followUps).where(eq(followUps.leadId, "rec-risky"));
    expect(rows.some((r) => r.status === "PENDING")).toBe(true);
    // Cooldown engages: the same lead is no longer a candidate.
    const again = await evaluateSingleLeadRecovery(ORG, "rec-risky", NOW);
    expect(again?.decision.shouldRecover).toBe(false);
  });

  it("single-lead evaluation is tenant scoped", async () => {
    expect(await evaluateSingleLeadRecovery("org-that-does-not-exist", "rec-risky", NOW)).toBeNull();
  });

  it("escalation creates a manager-owned task", async () => {
    await db.insert(leads).values({
      id: "rec-escalate",
      organizationId: ORG,
      source: "MANUAL",
      score: 70,
      temperature: "WARM",
      status: "QUALIFIED",
      budgetMaxInr: 6_000_000,
    });
    await db.insert(followUps).values([
      { organizationId: ORG, leadId: "rec-escalate", attemptNumber: 1, scheduledFor: isoHoursAgo(50), channel: "WEBSITE_CHAT", status: "PENDING" },
      { organizationId: ORG, leadId: "rec-escalate", attemptNumber: 2, scheduledFor: isoHoursAgo(26), channel: "WEBSITE_CHAT", status: "PENDING" },
    ]);
    const evaluated = await evaluateSingleLeadRecovery(ORG, "rec-escalate", NOW);
    expect(evaluated?.decision.actionType).toBe("MANAGER_ESCALATION");
    const result = await executeRecoveryAction(ORG, "rec-escalate", evaluated!.decision, {});
    expect(result.attempted).toBe(true);
    const taskRows = await db.select().from(tasks).where(eq(tasks.leadId, "rec-escalate"));
    expect(taskRows.length).toBe(1);
    expect(taskRows[0].assigneeId).toBe("rec-manager");
    expect(taskRows[0].isDone).toBe(false);
  });
});
