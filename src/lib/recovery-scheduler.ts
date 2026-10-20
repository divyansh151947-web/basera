import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  messages,
  organizations,
  recoveryClaims,
} from "@/db/schema";
import {
  AUTOPILOT_EXECUTE_ACTION,
  EXECUTE_IDEMPOTENCY_HOURS,
  findRecentAutopilotAudits,
  getRecoveryAutopilot,
  recordAutopilotAudit,
  type RevenueLeakType,
} from "./revenue-recovery-autopilot";
import {
  evaluateSingleLeadRecovery,
  executeRecoveryAction,
  type ExecutedRecovery,
  type RecoveryDecision,
} from "./recovery-engine";
import { getOrganizationNextBestActions } from "./next-best-action";
import { getLeadById } from "./data/leads";
import { getLatestConversationForLead } from "./data/conversations";

/**
 * PRODUCTION-SAFE SCHEDULED RECOVERY (Batch 8 Prompt 2).
 *
 * Consumes the Batch 8 / Prompt 1 autopilot read layer and the existing
 * recovery engine — it invents no detection, scoring, recommendation, or
 * sending of its own. Its ONLY job is reliable scheduled processing:
 *
 *   SCAN (bounded autopilot sweep, ACTION_NEEDED + AUTO only)
 *   → ATOMIC CLAIM (lead-scoped lease in recovery_claims)
 *   → REVALIDATE (fresh reads: lead, decision, NBA, activity, cooldowns)
 *   → EXECUTE (existing executeRecoveryAction, AUTO only)
 *   → RECORD (claim terminal state + audit trail)
 *   → NEVER DUPLICATE (six idempotency layers, §6)
 *
 * CONCURRENCY MODEL: two workers racing for one lead resolve through the
 * PRIMARY KEY on claim_key. INSERT ... ON CONFLICT DO NOTHING either wins
 * the lease (row returned) or loses (no row) — a single atomic statement,
 * never read-then-write. Reclaims of expired leases are compare-and-set
 * UPDATEs (WHERE key + old expires_at + old owner + CLAIMED): exactly one
 * racing worker matches a row. Ownership is re-verified by SELECT
 * immediately before execution, and terminal writes are ownership-guarded.
 *
 * SAFETY POSTURE: the scheduler executes ONLY AUTO-level decisions, and
 * only through the existing engine (which schedules PENDING follow-ups /
 * tasks / alerts — customer delivery, if any, happens exclusively through
 * the pre-existing follow-up cron abstraction). PREPARE/RECOMMEND outcomes
 * are recorded as DEFERRED for human handling, never auto-executed.
 */

export const SCHEDULER_LEASE_MS = 5 * 60 * 1000;
export const SCHEDULER_DEFAULT_PER_ORG_LIMIT = 10;
export const SCHEDULER_MAX_PER_ORG_LIMIT = 25;
export const SCHEDULER_DEFAULT_ORG_LIMIT = 20;
export const SCHEDULER_MAX_ORG_LIMIT = 50;

export const SCHEDULER_SKIP_ACTION = "RECOVERY_AUTOPILOT_SCHEDULER_SKIP";
export const SCHEDULER_DEFER_ACTION = "RECOVERY_AUTOPILOT_SCHEDULER_DEFER";

export type ClaimStatus = "CLAIMED" | "COMPLETED" | "SKIPPED" | "FAILED" | "DEFERRED";

export interface ClaimRow {
  claimKey: string;
  organizationId: string;
  leadId: string;
  leakType: string | null;
  actionType: string | null;
  claimedBy: string;
  claimedAt: string;
  expiresAt: string;
  status: ClaimStatus;
  resultSummary: string | null;
  updatedAt: string;
}

/** Deterministic opportunity identity: execution is lead-scoped, so the
 *  lease is per (organization, lead). */
export function claimKeyFor(organizationId: string, leadId: string): string {
  return `autopilot:v1:${organizationId}:${leadId}`;
}

function isContentionError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && code.startsWith("SQLITE_BUSY");
}

function isoNow(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

export async function getClaim(claimKey: string): Promise<ClaimRow | null> {
  const rows = await db.select().from(recoveryClaims).where(eq(recoveryClaims.claimKey, claimKey)).limit(1);
  return (rows[0] as ClaimRow | undefined) ?? null;
}

export interface ClaimAttempt {
  /** True when this worker now owns the lease. */
  claimed: boolean;
  /** Why a lost race happened (active lease held / terminal row). */
  reason: string | null;
  claim: ClaimRow | null;
}

/**
 * Atomic claim acquisition. Step 1: INSERT ... ON CONFLICT DO NOTHING —
 * exactly one racing worker gets a row back. Step 2 (only when the insert
 * lost): read the existing row; if it is an EXPIRED CLAIMED lease, take it
 * with a compare-and-set UPDATE on (key + old expires_at + old owner +
 * CLAIMED) — exactly one racing worker matches. Terminal rows and live
 * leases are never touched. SQLITE_BUSY (a second OS process holding the
 * SQLite write lock) is contention, not failure: report lost race.
 */
export async function attemptClaim(
  organizationId: string,
  leadId: string,
  opts: { runId: string; leakType?: string | null; actionType?: string | null; leaseMs?: number; nowMs?: number }
): Promise<ClaimAttempt> {
  const nowMs = opts.nowMs ?? Date.now();
  const leaseMs = opts.leaseMs ?? SCHEDULER_LEASE_MS;
  const key = claimKeyFor(organizationId, leadId);
  const nowIso = isoNow(nowMs);
  const expiresIso = isoNow(nowMs + leaseMs);

  try {
    const inserted = await db
      .insert(recoveryClaims)
      .values({
        claimKey: key,
        organizationId,
        leadId,
        leakType: opts.leakType ?? null,
        actionType: opts.actionType ?? null,
        claimedBy: opts.runId,
        claimedAt: nowIso,
        expiresAt: expiresIso,
        status: "CLAIMED",
        resultSummary: null,
        updatedAt: nowIso,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted.length > 0) {
      return { claimed: true, reason: null, claim: inserted[0] as ClaimRow };
    }
  } catch (err) {
    if (isContentionError(err)) {
      return { claimed: false, reason: "write-contention", claim: null };
    }
    throw err;
  }

  // Lost the insert race (or the row predates us): only an EXPIRED CLAIMED
  // lease may be taken, via compare-and-set on the exact values observed.
  const existing = await getClaim(key);
  if (!existing) {
    // Row vanished between insert and select (cascade delete): retry once.
    return attemptClaim(organizationId, leadId, opts);
  }
  if (existing.organizationId !== organizationId || existing.leadId !== leadId) {
    return { claimed: false, reason: "claim-key-mismatch", claim: existing };
  }
  if (existing.status !== "CLAIMED") {
    return { claimed: false, reason: `already-${existing.status.toLowerCase()}`, claim: existing };
  }
  if (existing.expiresAt > nowIso) {
    return { claimed: false, reason: "claimed-by-other", claim: existing };
  }
  try {
    const reclaimed = await db
      .update(recoveryClaims)
      .set({
        claimedBy: opts.runId,
        claimedAt: nowIso,
        expiresAt: expiresIso,
        leakType: opts.leakType ?? existing.leakType,
        actionType: opts.actionType ?? existing.actionType,
        status: "CLAIMED",
        resultSummary: null,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(recoveryClaims.claimKey, key),
          eq(recoveryClaims.status, "CLAIMED"),
          eq(recoveryClaims.expiresAt, existing.expiresAt),
          eq(recoveryClaims.claimedBy, existing.claimedBy)
        )
      )
      .returning();
    if (reclaimed.length > 0) {
      return { claimed: true, reason: null, claim: reclaimed[0] as ClaimRow };
    }
    return { claimed: false, reason: "reclaim-race-lost", claim: await getClaim(key) };
  } catch (err) {
    if (isContentionError(err)) {
      return { claimed: false, reason: "write-contention", claim: existing };
    }
    throw err;
  }
}

/** Final ownership verification immediately before execution (Layer 6). */
export async function verifyClaimOwnership(
  claimKey: string,
  runId: string,
  nowMs: number = Date.now()
): Promise<boolean> {
  const row = await getClaim(claimKey);
  return (
    row != null &&
    row.claimedBy === runId &&
    row.status === "CLAIMED" &&
    row.expiresAt > isoNow(nowMs)
  );
}

/**
 * Ownership-guarded terminal write. Returns false when another worker owns
 * the lease (caller must not proceed); never overwrites a foreign owner.
 */
export async function completeClaim(
  claimKey: string,
  runId: string,
  status: Exclude<ClaimStatus, "CLAIMED">,
  resultSummary: string,
  nowMs: number = Date.now()
): Promise<boolean> {
  const rows = await db
    .update(recoveryClaims)
    .set({ status, resultSummary: resultSummary.slice(0, 500), updatedAt: isoNow(nowMs) })
    .where(and(eq(recoveryClaims.claimKey, claimKey), eq(recoveryClaims.claimedBy, runId)))
    .returning({ claimKey: recoveryClaims.claimKey });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Revalidation (fresh reads immediately before any AUTO execution)
// ---------------------------------------------------------------------------

export interface Revalidation {
  ok: boolean;
  /** Machine-readable skip/defer code for the run summary. */
  code: string;
  /** Human-readable, PII-free explanation. */
  reason: string;
  decision?: RecoveryDecision;
}

export interface RevalidateDeps {
  nowMs: number;
  scanIso: string;
  nbaActionByLead: Map<string, string>;
}

/**
 * Layer-1/2/3/5 rechecks on live rows. Anything that changed since the scan
 * — close, opt-out, fresh customer activity, pending work, cooldowns, NBA
 * deferral, recent execution — turns into a skip/defer, never an execution.
 */
export async function revalidateLeadForAuto(
  organizationId: string,
  leadId: string,
  deps: RevalidateDeps
): Promise<Revalidation> {
  const no = (code: string, reason: string): Revalidation => ({ ok: false, code, reason });

  const lead = await getLeadById(organizationId, leadId);
  if (!lead) return no("lead-not-found", "Lead no longer exists in this organization.");
  if (lead.status === "CONVERTED" || lead.status === "LOST") {
    return no("lead-closed", `Lead is ${lead.status.toLowerCase()} — recovery is inappropriate.`);
  }
  if (lead.optedOut) return no("lead-opted-out", "Lead opted out — recovery is inappropriate.");

  // Stale-scan guard FIRST: any inbound customer message newer than the scan
  // invalidates the recommendation before any other logic runs. Fresh
  // activity means re-evaluate on a later run — never send a stale action,
  // and never even stage a defer for an already-superseded read. (Checked
  // before the decision on purpose: a fresh reply would otherwise flip the
  // decision to AGENT_ALERT and look actionable, when the right move is to
  // stand down and let the next scan see the new thread state.)
  const latestConv = await getLatestConversationForLead(organizationId, leadId);
  if (latestConv) {
    const inbound = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, latestConv.id), eq(messages.sender, "LEAD")))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const newestInbound = inbound[0]?.createdAt;
    if (newestInbound && new Date(newestInbound).getTime() > new Date(deps.scanIso).getTime()) {
      return no("stale-new-activity", "Customer activity recorded after the scan — re-evaluate instead of sending a stale action.");
    }
  }

  const evaluated = await evaluateSingleLeadRecovery(organizationId, leadId, deps.nowMs);
  if (!evaluated) return no("lead-not-found", "Lead no longer exists in this organization.");
  if (!evaluated.decision.shouldRecover) {
    return no("no-recovery", evaluated.decision.noActionReason ?? "No recovery warranted on fresh reads.");
  }
  if (evaluated.decision.automation !== "AUTO") {
    return { ok: false, code: "defer-level", reason: `Decision is ${evaluated.decision.automation ?? "non-AUTO"} — left for human handling, never auto-executed.`, decision: evaluated.decision };
  }

  const nbaAction = deps.nbaActionByLead.get(leadId);
  if (nbaAction === "NO_ACTION" || nbaAction === "WAIT_AND_MONITOR") {
    return no("nba-defers", `Next Best Action is ${nbaAction} on fresh reads — respected, not forced.`);
  }

  // Idempotency layer: a recent execute marker (API or scheduler) wins.
  const recentExecutes = await findRecentAutopilotAudits(
    organizationId,
    AUTOPILOT_EXECUTE_ACTION,
    isoNow(deps.nowMs - EXECUTE_IDEMPOTENCY_HOURS * 3_600_000),
    100
  );
  if (recentExecutes.some((a) => a.entityId === leadId)) {
    return no("recently-executed", "A recovery action was already executed for this lead recently — duplicate prevented.");
  }

  return { ok: true, code: "eligible", reason: "Eligible on fresh reads.", decision: evaluated.decision };
}

// ---------------------------------------------------------------------------
// Batch runner
// ---------------------------------------------------------------------------

export interface SchedulerCandidate {
  leadId: string;
  leakType: string;
}

export interface SchedulerItemResult {
  leadId: string;
  leakType: string;
  outcome: "EXECUTED" | "SKIPPED" | "DEFERRED" | "FAILED" | "CLAIM_LOST";
  reason: string;
}

export interface SchedulerSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  orgsScanned: number;
  scanned: number;
  eligible: number;
  claimed: number;
  skipped: number;
  executed: number;
  deferred: number;
  failed: number;
  released: number;
  /** Per-lead outcomes (internal UUIDs only — no names, messages, revenue). */
  items: SchedulerItemResult[];
  /** NEVER a number: scheduled activity cannot prove collected revenue. */
  recoveredRevenue: null;
}

export interface SchedulerOptions {
  nowMs?: number;
  /** Opportunities attempted per organization (bounded). */
  perOrgLimit?: number;
  /** Organizations scanned per run (bounded). */
  orgLimit?: number;
  /** Lease lifetime for claims. */
  leaseMs?: number;
  /** Test/ops scoping. The HTTP route NEVER sets this (all orgs, bounded). */
  organizationIds?: string[];
  /** Injectable executor (tests force failures without touching engines). */
  executeFn?: (
    organizationId: string,
    leadId: string,
    decision: RecoveryDecision,
    exec: { assignedAgentId?: string | null; conversationId?: string | null; channel?: string }
  ) => Promise<ExecutedRecovery>;
}

type ExecuteFn = NonNullable<SchedulerOptions["executeFn"]>;

const defaultExecute: ExecuteFn = (orgId, leadId, decision, exec) =>
  executeRecoveryAction(orgId, leadId, decision, exec);

function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // Messages only — never stacks/paths/tokens. Cap length for the audit row.
  return message.replace(/[\r\n]+/g, " ").slice(0, 300) || "Unknown error";
}

export async function runRecoverySchedulerBatch(opts: SchedulerOptions = {}): Promise<SchedulerSummary> {
  const nowMs = opts.nowMs ?? Date.now();
  const startedAt = isoNow(nowMs);
  const runId = crypto.randomUUID();
  const perOrgLimit = Math.max(1, Math.min(opts.perOrgLimit ?? SCHEDULER_DEFAULT_PER_ORG_LIMIT, SCHEDULER_MAX_PER_ORG_LIMIT));
  const orgLimit = Math.max(1, Math.min(opts.orgLimit ?? SCHEDULER_DEFAULT_ORG_LIMIT, SCHEDULER_MAX_ORG_LIMIT));
  const leaseMs = opts.leaseMs ?? SCHEDULER_LEASE_MS;
  const executeFn = opts.executeFn ?? defaultExecute;

  const summary: SchedulerSummary = {
    runId,
    startedAt,
    finishedAt: startedAt,
    orgsScanned: 0,
    scanned: 0,
    eligible: 0,
    claimed: 0,
    skipped: 0,
    executed: 0,
    deferred: 0,
    failed: 0,
    released: 0,
    items: [],
    recoveredRevenue: null,
  };

  const orgRows =
    opts.organizationIds && opts.organizationIds.length > 0
      ? opts.organizationIds.slice(0, orgLimit).map((id) => ({ id }))
      : await db.select({ id: organizations.id }).from(organizations).limit(orgLimit);

  for (const { id: organizationId } of orgRows) {
    summary.orgsScanned += 1;
    try {
      // Bounded sweep: ACTION_NEEDED + AUTO leaks only, deduped per lead
      // (execution is lead-scoped; first leak = highest priority).
      const autopilot = await getRecoveryAutopilot(organizationId, { now: nowMs, limit: perOrgLimit });
      const seenLeads = new Set<string>();
      const candidates: SchedulerCandidate[] = [];
      for (const leak of autopilot.leaks) {
        if (leak.recoveryStatus !== "ACTION_NEEDED" || leak.automation !== "AUTO") continue;
        if (seenLeads.has(leak.leadId)) continue;
        seenLeads.add(leak.leadId);
        candidates.push({ leadId: leak.leadId, leakType: leak.type });
        if (candidates.length >= perOrgLimit) break;
      }
      summary.scanned += autopilot.leaks.length;
      summary.eligible += candidates.length;

      if (candidates.length === 0) continue;

      // One bounded NBA read per org, reused for every revalidation.
      const nba = await getOrganizationNextBestActions(organizationId, { now: nowMs, limit: 50 });
      const nbaActionByLead = new Map(nba.actions.map((a) => [a.leadId, a.action]));

      for (const candidate of candidates) {
        const key = claimKeyFor(organizationId, candidate.leadId);
        try {
          const attempt = await attemptClaim(organizationId, candidate.leadId, {
            runId,
            leakType: candidate.leakType as RevenueLeakType,
            leaseMs,
            nowMs,
          });
          if (!attempt.claimed) {
            summary.skipped += 1;
            summary.items.push({ leadId: candidate.leadId, leakType: candidate.leakType, outcome: "CLAIM_LOST", reason: attempt.reason ?? "claim-contention" });
            continue;
          }
          summary.claimed += 1;

          const recheck = await revalidateLeadForAuto(organizationId, candidate.leadId, {
            nowMs,
            scanIso: autopilot.calculatedAt,
            nbaActionByLead,
          });
          if (!recheck.ok) {
            if (recheck.code === "defer-level") {
              await completeClaim(key, runId, "DEFERRED", recheck.reason, nowMs);
              await recordAutopilotAudit(organizationId, null, SCHEDULER_DEFER_ACTION, candidate.leadId, {
                leakType: candidate.leakType,
                reason: recheck.reason,
                runId,
              });
              summary.deferred += 1;
              summary.released += 1;
              summary.items.push({ leadId: candidate.leadId, leakType: candidate.leakType, outcome: "DEFERRED", reason: recheck.code });
            } else {
              await completeClaim(key, runId, "SKIPPED", recheck.reason, nowMs);
              await recordAutopilotAudit(organizationId, null, SCHEDULER_SKIP_ACTION, candidate.leadId, {
                leakType: candidate.leakType,
                reason: recheck.reason,
                runId,
              });
              summary.skipped += 1;
              summary.released += 1;
              summary.items.push({ leadId: candidate.leadId, leakType: candidate.leakType, outcome: "SKIPPED", reason: recheck.code });
            }
            continue;
          }

          // Final ownership check immediately before the engine call.
          if (!(await verifyClaimOwnership(key, runId, nowMs))) {
            summary.skipped += 1;
            summary.items.push({ leadId: candidate.leadId, leakType: candidate.leakType, outcome: "CLAIM_LOST", reason: "ownership-lost" });
            continue;
          }

          const lead = await getLeadById(organizationId, candidate.leadId);
          const result = await executeFn(organizationId, candidate.leadId, recheck.decision!, {
            assignedAgentId: lead?.assignedAgentId ?? null,
            conversationId: (await getLatestConversationForLead(organizationId, candidate.leadId))?.id ?? null,
          });
          await recordAutopilotAudit(organizationId, null, AUTOPILOT_EXECUTE_ACTION, candidate.leadId, {
            leakType: candidate.leakType,
            actionType: result.actionType,
            automation: result.automation,
            recordKind: result.recordKind,
            runId,
            summary: `Scheduler executed ${result.actionType ?? "recovery"} via ${result.automation ?? "unknown"} path. Attempt — not revenue.`,
          });
          await completeClaim(key, runId, "COMPLETED", result.outcome, nowMs);
          summary.executed += 1;
          summary.released += 1;
          summary.items.push({ leadId: candidate.leadId, leakType: candidate.leakType, outcome: "EXECUTED", reason: result.recordKind ?? "attempt" });
        } catch (err) {
          // Per-opportunity failure: record, release safely, continue batch.
          try {
            await completeClaim(key, runId, "FAILED", sanitizeError(err), nowMs);
            summary.released += 1;
          } catch {
            // Claim release itself failed (e.g. cascade-deleted lead took
            // the row): nothing left to release — still count the failure.
          }
          summary.failed += 1;
          summary.items.push({ leadId: candidate.leadId, leakType: candidate.leakType, outcome: "FAILED", reason: "execution-error" });
        }
      }
    } catch {
      // Per-organization failure (e.g. transient read error): skip the org,
      // continue the batch. No PII, no secrets in the trail.
      continue;
    }
  }

  summary.finishedAt = isoNow(Date.now());
  return summary;
}
