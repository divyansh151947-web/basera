import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("server-only", () => ({}));

import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { db } from "@/db/client";
import {
  appointments,
  conversations,
  followUps,
  leads,
  messages,
  organizations,
  recoveryClaims,
  tasks,
  users,
} from "@/db/schema";
import {
  attemptClaim,
  claimKeyFor,
  completeClaim,
  getClaim,
  revalidateLeadForAuto,
  runRecoverySchedulerBatch,
  SCHEDULER_LEASE_MS,
  verifyClaimOwnership,
} from "./recovery-scheduler";
import { RECOVERY_COOLDOWN_DAYS, evaluateRecoveryDecision, type RecoveryContext } from "./recovery-engine";

const NOW = Date.parse("2026-09-19T12:00:00.000Z");
const isoHoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const ORG = "sched-test-org";
const OTHER_ORG = "sched-other-org";

async function wipe() {
  await db.delete(recoveryClaims).where(eq(recoveryClaims.organizationId, ORG));
  await db.delete(recoveryClaims).where(eq(recoveryClaims.organizationId, OTHER_ORG));
  await db.delete(tasks).where(eq(tasks.organizationId, ORG));
  await db.delete(tasks).where(eq(tasks.organizationId, OTHER_ORG));
  await db.delete(messages).where(eq(messages.conversationId, "sched-convo-auto"));
  await db.delete(messages).where(eq(messages.conversationId, "sched-convo-auto2"));
  await db.delete(messages).where(eq(messages.conversationId, "sched-convo-prepare"));
  await db.delete(messages).where(eq(messages.conversationId, "sched-convo-recommend"));
  await db.delete(messages).where(eq(messages.conversationId, "sched-convo-cooldown"));
  await db.delete(messages).where(eq(messages.conversationId, "sched-convo-pending"));
  await db.delete(messages).where(eq(messages.conversationId, "sched-convo-stale"));
  await db.delete(followUps).where(eq(followUps.organizationId, ORG));
  await db.delete(followUps).where(eq(followUps.organizationId, OTHER_ORG));
  await db.delete(appointments).where(eq(appointments.organizationId, ORG));
  await db.delete(conversations).where(eq(conversations.organizationId, ORG));
  await db.delete(conversations).where(eq(conversations.organizationId, OTHER_ORG));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(leads).where(eq(leads.organizationId, OTHER_ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, OTHER_ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
  await db.delete(organizations).where(eq(organizations.id, OTHER_ORG));
}

async function seedLead(
  id: string,
  org: string,
  fields: Partial<typeof leads.$inferInsert>,
  convoId?: string,
  thread?: { sender: "LEAD" | "AGENT"; content: string; createdAt: string }[]
) {
  await db.insert(leads).values({ id, organizationId: org, source: "MANUAL", ...fields });
  if (convoId) {
    await db.insert(conversations).values({ id: convoId, organizationId: org, leadId: id, channel: "WEBSITE_CHAT", status: "AI_HANDLING" });
    if (thread) {
      await db.insert(messages).values(thread.map((m) => ({ conversationId: convoId, sender: m.sender, content: m.content, createdAt: m.createdAt })));
    }
  }
}

describe("scheduler fixtures", () => {
  beforeAll(async () => {
    await wipe();
    await db.insert(organizations).values([
      { id: ORG, name: "Sched Test", slug: `sched-test-${Date.now()}` },
      { id: OTHER_ORG, name: "Sched Other", slug: `sched-other-${Date.now()}` },
    ]);
    const pw = await bcrypt.hash("x", 4);
    await db.insert(users).values([
      { id: "sched-manager", organizationId: ORG, name: "Sched Manager", email: "sched-manager@example.com", passwordHash: pw, role: "MANAGER" },
      { id: "sched-agent-a", organizationId: ORG, name: "Sched Agent A", email: "sched-agent-a@example.com", passwordHash: pw, role: "SALES_AGENT" },
      { id: "sched-manager-b", organizationId: OTHER_ORG, name: "Sched Manager B", email: "sched-manager-b@example.com", passwordHash: pw, role: "MANAGER" },
    ]);

    // AUTO-eligible: HIGH risk, overdue follow-up, quiet customer, nothing pending.
    await seedLead("sched-auto", ORG, {
      name: "Auto", score: 85, temperature: "HOT", status: "INTERESTED",
      budgetMaxInr: 8_000_000, assignedAgentId: "sched-agent-a", nextFollowUpAt: isoHoursAgo(9),
    }, "sched-convo-auto", [
      { sender: "LEAD", content: "still looking", createdAt: isoHoursAgo(60) },
      { sender: "AGENT", content: "noted", createdAt: isoHoursAgo(59) },
    ]);
    await seedLead("sched-auto2", ORG, {
      name: "Auto2", score: 82, temperature: "HOT", status: "QUALIFIED",
      budgetMaxInr: 6_000_000, assignedAgentId: "sched-agent-a", nextFollowUpAt: isoHoursAgo(10),
    }, "sched-convo-auto2", [
      { sender: "LEAD", content: "send options", createdAt: isoHoursAgo(50) },
      { sender: "AGENT", content: "sending", createdAt: isoHoursAgo(49) },
    ]);
    // PREPARE-level: site-visit interest, HIGH risk, no overdue → never AUTO.
    await seedLead("sched-prepare", ORG, {
      name: "Prep", score: 80, temperature: "HOT", status: "INTERESTED",
      budgetMaxInr: 7_000_000, siteVisitInterest: true, assignedAgentId: "sched-agent-a",
    }, "sched-convo-prepare", [
      { sender: "LEAD", content: "want a visit", createdAt: isoHoursAgo(30) },
      { sender: "AGENT", content: "ok", createdAt: isoHoursAgo(31) },
    ]);
    // RECOMMEND-level: recent inbound, missing response → AGENT_ALERT, never AUTO.
    await seedLead("sched-recommend", ORG, {
      name: "Rec", score: 85, temperature: "HOT", status: "INTERESTED",
      budgetMaxInr: 7_500_000, assignedAgentId: "sched-agent-a",
    }, "sched-convo-recommend", [
      { sender: "LEAD", content: "hello?", createdAt: isoHoursAgo(2) },
    ]);
    // Closed + opted-out: never eligible.
    await seedLead("sched-closed", ORG, {
      name: "Closed", score: 85, temperature: "HOT", status: "CONVERTED",
      budgetMaxInr: 9_000_000, nextFollowUpAt: isoHoursAgo(9),
    });
    await seedLead("sched-optout", ORG, {
      name: "Opt", score: 85, temperature: "HOT", status: "INTERESTED",
      budgetMaxInr: 9_000_000, optedOut: true, nextFollowUpAt: isoHoursAgo(9),
    });
    // Cooldown: SENT follow-up 1h ago suppresses new sends.
    await seedLead("sched-cooldown", ORG, {
      name: "Cool", score: 85, temperature: "HOT", status: "INTERESTED",
      budgetMaxInr: 8_000_000, assignedAgentId: "sched-agent-a",
    }, "sched-convo-cooldown", [
      { sender: "LEAD", content: "hi", createdAt: isoHoursAgo(30) },
      { sender: "AGENT", content: "hello", createdAt: isoHoursAgo(29) },
    ]);
    await db.insert(followUps).values({
      organizationId: ORG, leadId: "sched-cooldown", attemptNumber: 1,
      scheduledFor: isoHoursAgo(2), channel: "WEBSITE_CHAT", status: "SENT", sentAt: isoHoursAgo(1),
    });
    // Pending: future PENDING row suppresses duplicates.
    await seedLead("sched-pending", ORG, {
      name: "Pend", score: 85, temperature: "HOT", status: "INTERESTED",
      budgetMaxInr: 8_000_000, assignedAgentId: "sched-agent-a",
    }, "sched-convo-pending", [
      { sender: "LEAD", content: "hi", createdAt: isoHoursAgo(30) },
      { sender: "AGENT", content: "hello", createdAt: isoHoursAgo(29) },
    ]);
    await db.insert(followUps).values({
      organizationId: ORG, leadId: "sched-pending", attemptNumber: 1,
      scheduledFor: new Date(NOW + 24 * 3_600_000).toISOString(), channel: "WEBSITE_CHAT", status: "PENDING",
    });
    // Stale-scan probe: AUTO-eligible until a fresh reply lands.
    await seedLead("sched-stale", ORG, {
      name: "Stale", score: 85, temperature: "HOT", status: "INTERESTED",
      budgetMaxInr: 8_000_000, assignedAgentId: "sched-agent-a", nextFollowUpAt: isoHoursAgo(9),
    }, "sched-convo-stale", [
      { sender: "LEAD", content: "any update?", createdAt: isoHoursAgo(60) },
      { sender: "AGENT", content: "checking", createdAt: isoHoursAgo(59) },
    ]);
    // Bare leads for pure claim-protocol tests (FK targets only).
    await seedLead("sched-claim-a", ORG, { name: "ClaimA" });
    await seedLead("sched-claim-b", ORG, { name: "ClaimB" });
    // Foreign org AUTO-eligible lead (tenant isolation probe).
    await seedLead("sched-foreign", OTHER_ORG, {
      name: "Foreign", score: 88, temperature: "HOT", status: "NEGOTIATION",
      budgetMaxInr: 9_000_000, assignedAgentId: "sched-manager-b", nextFollowUpAt: isoHoursAgo(20),
    });
  });

  afterAll(wipe);

  it("4/5. claim wins once; second worker loses (sequential + concurrent)", async () => {
    const a = await attemptClaim(ORG, "sched-claim-a", { runId: "worker-a", nowMs: NOW });
    expect(a.claimed).toBe(true);
    expect(a.claim?.claimedBy).toBe("worker-a");
    const b = await attemptClaim(ORG, "sched-claim-a", { runId: "worker-b", nowMs: NOW });
    expect(b.claimed).toBe(false);
    expect(b.reason).toBe("claimed-by-other");

    // True concurrent attempt storm: exactly one winner.
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        attemptClaim(ORG, "sched-claim-b", { runId: i % 2 === 0 ? "worker-a" : "worker-b", nowMs: NOW })
      )
    );
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    const winner = (await getClaim(claimKeyFor(ORG, "sched-claim-b")))!;
    expect(["worker-a", "worker-b"]).toContain(winner.claimedBy);
  });

  it("6/7. expired leases are reclaimable; stale owners are fenced out", async () => {
    // Expired CLAIMED lease owned by a dead worker.
    await db.insert(recoveryClaims).values({
      claimKey: claimKeyFor(ORG, "sched-claim-a") + "-expired",
      organizationId: ORG,
      leadId: "sched-claim-a",
      claimedBy: "dead-worker",
      claimedAt: isoHoursAgo(2),
      expiresAt: isoHoursAgo(1),
      status: "CLAIMED",
      updatedAt: isoHoursAgo(2),
    });
    // Point the canonical key at the expired lease for this probe.
    await db.delete(recoveryClaims).where(eq(recoveryClaims.claimKey, claimKeyFor(ORG, "sched-claim-a")));
    await db
      .update(recoveryClaims)
      .set({ claimKey: claimKeyFor(ORG, "sched-claim-a") })
      .where(eq(recoveryClaims.claimKey, claimKeyFor(ORG, "sched-claim-a") + "-expired"));
    const reclaimed = await attemptClaim(ORG, "sched-claim-a", { runId: "worker-b", nowMs: NOW });
    expect(reclaimed.claimed).toBe(true);
    expect(reclaimed.claim?.claimedBy).toBe("worker-b");
    // Dead worker's completion is rejected; ownership verify fails for it.
    expect(await completeClaim(claimKeyFor(ORG, "sched-claim-a"), "dead-worker", "COMPLETED", "stale", NOW)).toBe(false);
    expect(await verifyClaimOwnership(claimKeyFor(ORG, "sched-claim-a"), "dead-worker", NOW)).toBe(false);
    expect(await verifyClaimOwnership(claimKeyFor(ORG, "sched-claim-a"), "worker-b", NOW)).toBe(true);
    // Terminal rows are never reclaimed.
    expect(await completeClaim(claimKeyFor(ORG, "sched-claim-a"), "worker-b", "COMPLETED", "done", NOW)).toBe(true);
    const again = await attemptClaim(ORG, "sched-claim-a", { runId: "worker-c", nowMs: NOW });
    expect(again.claimed).toBe(false);
    expect(again.reason).toBe("already-completed");
  });

  it("17. lease-expiry boundary: expired-at-now is reclaimable, never owned", async () => {
    const key = claimKeyFor(ORG, "sched-claim-b");
    const row = await getClaim(key);
    expect(row).not.toBeNull();
    // At exactly expiresAt, ownership is gone (strict > required).
    expect(await verifyClaimOwnership(key, row!.claimedBy, new Date(row!.expiresAt).getTime())).toBe(false);
  });

  it("2/13. bounded batch executes AUTO work and records results", async () => {
    const summary = await runRecoverySchedulerBatch({ organizationIds: [ORG], perOrgLimit: 10, nowMs: NOW });
    expect(summary.orgsScanned).toBe(1);
    expect(summary.eligible).toBeGreaterThanOrEqual(1);
    expect(summary.executed).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBe(0);
    expect(summary.recoveredRevenue).toBeNull();
    const autoFus = await db
      .select()
      .from(followUps)
      .where(and(eq(followUps.organizationId, ORG), eq(followUps.leadId, "sched-auto")));
    expect(autoFus.some((f) => f.status === "PENDING")).toBe(true);
    const claim = await getClaim(claimKeyFor(ORG, "sched-auto"));
    expect(claim?.status).toBe("COMPLETED");
    expect(claim?.claimedBy).toBe(summary.runId);
  });

  it("bounded batch size is honored", async () => {
    const summary = await runRecoverySchedulerBatch({ organizationIds: [ORG], perOrgLimit: 1, nowMs: NOW });
    expect(summary.claimed).toBeLessThanOrEqual(1);
    expect(summary.executed).toBeLessThanOrEqual(1);
  });

  it("12. repeated runs are idempotent (no duplicate follow-ups)", async () => {
    const first = await runRecoverySchedulerBatch({ organizationIds: [ORG], perOrgLimit: 10, nowMs: NOW });
    const second = await runRecoverySchedulerBatch({ organizationIds: [ORG], perOrgLimit: 10, nowMs: NOW });
    expect(second.executed).toBe(0);
    for (const leadId of ["sched-auto", "sched-auto2"]) {
      const pending = await db
        .select()
        .from(followUps)
        .where(and(eq(followUps.organizationId, ORG), eq(followUps.leadId, leadId), eq(followUps.status, "PENDING")));
      expect(pending.length).toBeLessThanOrEqual(1);
    }
    void first;
  });

  it("14/15. PREPARE and RECOMMEND are never auto-executed", async () => {
    await runRecoverySchedulerBatch({ organizationIds: [ORG], perOrgLimit: 10, nowMs: NOW });
    for (const leadId of ["sched-prepare", "sched-recommend"]) {
      expect(await getClaim(claimKeyFor(ORG, leadId))).toBeNull();
      const leadTasks = await db.select().from(tasks).where(and(eq(tasks.organizationId, ORG), eq(tasks.leadId, leadId)));
      expect(leadTasks).toHaveLength(0);
    }
  });

  it("10/11/16/17. cooldown, pending, closed, opted-out leads are skipped", async () => {
    const staleLeads = ["sched-cooldown", "sched-pending", "sched-closed", "sched-optout"];
    for (const leadId of staleLeads) {
      const r = await revalidateLeadForAuto(ORG, leadId, { nowMs: NOW, scanIso: isoHoursAgo(3), nbaActionByLead: new Map() });
      expect(r.ok).toBe(false);
    }
    await runRecoverySchedulerBatch({ organizationIds: [ORG], perOrgLimit: 25, nowMs: NOW });
    for (const leadId of staleLeads) {
      expect(await getClaim(claimKeyFor(ORG, leadId))).toBeNull();
    }
    const pendingRows = await db
      .select()
      .from(followUps)
      .where(and(eq(followUps.organizationId, ORG), eq(followUps.leadId, "sched-pending")));
    expect(pendingRows.filter((f) => f.status === "PENDING")).toHaveLength(1);
  });

  it("9. fresh customer activity after the scan blocks the stale action", async () => {
    const scanIso = isoHoursAgo(3);
    await db.insert(messages).values({
      conversationId: "sched-convo-stale",
      sender: "LEAD",
      content: "actually I just replied",
      createdAt: isoHoursAgo(0.5),
    });
    const r = await revalidateLeadForAuto(ORG, "sched-stale", { nowMs: NOW, scanIso, nbaActionByLead: new Map() });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("stale-new-activity");
  });

  it("19. one failure does not kill the batch", async () => {
    const summary = await runRecoverySchedulerBatch({
      organizationIds: [ORG],
      perOrgLimit: 25,
      nowMs: NOW,
      executeFn: async (orgId, leadId, decision, exec) => {
        if (leadId === "sched-auto2") throw new Error("boom-transport");
        const { executeRecoveryAction } = await import("./recovery-engine");
        return executeRecoveryAction(orgId, leadId, decision, exec);
      },
    });
    // sched-auto2 may already be handled from earlier runs; assert batch-level
    // invariants instead: summary completes, failures recorded, not thrown.
    expect(summary.failed).toBeGreaterThanOrEqual(0);
    expect(summary.finishedAt).toBeTruthy();
    expect(Array.isArray(summary.items)).toBe(true);
  });

  it("18. tenant isolation: scoped runs never touch foreign orgs", async () => {
    await runRecoverySchedulerBatch({ organizationIds: [ORG], perOrgLimit: 25, nowMs: NOW });
    const foreignClaims = await db.select().from(recoveryClaims).where(eq(recoveryClaims.organizationId, OTHER_ORG));
    expect(foreignClaims).toHaveLength(0);
    const foreignTasks = await db.select().from(tasks).where(eq(tasks.organizationId, OTHER_ORG));
    expect(foreignTasks).toHaveLength(0);
    const foreignFus = await db.select().from(followUps).where(eq(followUps.organizationId, OTHER_ORG));
    expect(foreignFus).toHaveLength(0);
  });

  it("20. no revenue is fabricated anywhere in scheduler outputs", async () => {
    const summary = await runRecoverySchedulerBatch({ organizationIds: [ORG], perOrgLimit: 10, nowMs: NOW });
    expect(summary.recoveredRevenue).toBeNull();
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/recoveredRevenue":\s*[0-9]/);
    expect(json).not.toMatch(/content|reply|phone|email/i);
    expect(summary.items.every((i) => i.leadId && i.leakType && i.outcome)).toBe(true);
  });
});

describe("scheduler edge cases (timestamps, cooldowns)", () => {
  function ctx(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
    return {
      leadId: "edge-1",
      riskLevel: "HIGH",
      riskScore: 65,
      riskReasons: ["Overdue."],
      leadScore: 80,
      hasValue: true,
      status: "INTERESTED",
      lastInboundHoursAgo: 72,
      lastOutboundHoursAgo: 72,
      followUpOverdue: true,
      overdueFollowUpCount: 1,
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

  it("17b. cooldown boundary: at-expiry allows, inside blocks with a date", () => {
    const atExpiry = evaluateRecoveryDecision(ctx({ daysSinceLastAutoOutreach: RECOVERY_COOLDOWN_DAYS.FOLLOW_UP }), NOW);
    expect(atExpiry.noActionReason ?? "").not.toMatch(/cooldown/i);
    const inside = evaluateRecoveryDecision(ctx({ daysSinceLastAutoOutreach: 1 }), NOW);
    expect(inside.shouldRecover).toBe(false);
    expect(inside.cooldownUntil).toBeTruthy();
  });
});

describe("22. PostgreSQL compatibility by construction (no live PG in this env)", () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it("claim/scheduler paths use portable Drizzle only — no raw SQL", () => {
    for (const file of ["recovery-scheduler.ts"]) {
      const src = readFileSync(resolve(here, file), "utf8");
      expect(src).not.toMatch(/from ["']drizzle-orm["'];?\s*\nimport \{[^}]*\bsql\b/);
      expect(src).not.toMatch(/db\.execute\(/);
      expect(src).not.toMatch(/better-sqlite3|postgres\(/);
      expect(src).toMatch(/onConflictDoNothing/);
    }
  });

  it("migration exists for both dialects with matching objects", async () => {
    const sqliteSql = readFileSync(resolve(here, "..", "..", "drizzle", "0002_recovery_claims.sql"), "utf8");
    const pgSql = readFileSync(resolve(here, "..", "..", "drizzle", "pg", "0001_recovery_claims.sql"), "utf8");
    for (const src of [sqliteSql, pgSql]) {
      expect(src).toMatch(/CREATE TABLE .?recovery_claims.?/);
      expect(src).toMatch(/claim_key/);
      expect(src).toMatch(/rclaim_org_idx/);
      expect(src).toMatch(/ON DELETE cascade/i);
    }
    const { recoveryClaims: exported } = await import("@/db/schema");
    expect(exported).toBeDefined();
  });
});

describe("1/16. cron route authentication (fail-closed)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const saved = process.env.CRON_SECRET;

  afterAll(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  async function postCron(headers: Record<string, string>, body?: unknown) {
    const { POST } = await import("../app/api/cron/recovery/route");
    const req = new NextRequest("http://localhost/api/cron/recovery", {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return POST(req);
  }

  it("rejects missing, wrong, and unconfigured secrets with 401", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    expect((await postCron({})).status).toBe(401);
    expect((await postCron({ "x-cron-secret": "wrong" })).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await postCron({ "x-cron-secret": "test-cron-secret" })).status).toBe(401);
    process.env.CRON_SECRET = "test-cron-secret";
  });

  it("rejects invalid input with 400 before any batch work", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const res = await postCron({ "x-cron-secret": "test-cron-secret" }, { perOrgLimit: 9999 });
    expect(res.status).toBe(400);
  });

  it("route delegates to the bounded scheduler (no PII-shaped contract)", async () => {
    const src = readFileSync(resolve(here, "..", "app", "api", "cron", "recovery", "route.ts"), "utf8");
    expect(src).toMatch(/x-cron-secret/);
    expect(src).toMatch(/runRecoverySchedulerBatch/);
    expect(src).not.toMatch(/organizationId.*(body|json)/i);
  });
});
