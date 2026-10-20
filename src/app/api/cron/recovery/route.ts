import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isCronAuthorized } from "@/lib/cron-auth";
import {
  runRecoverySchedulerBatch,
  SCHEDULER_DEFAULT_ORG_LIMIT,
  SCHEDULER_DEFAULT_PER_ORG_LIMIT,
  SCHEDULER_LEASE_MS,
  SCHEDULER_MAX_ORG_LIMIT,
  SCHEDULER_MAX_PER_ORG_LIMIT,
} from "@/lib/recovery-scheduler";

/**
 * POST /api/cron/recovery — scheduled Revenue Recovery Autopilot.
 *
 * Intended for an external scheduler (cron, Vercel Cron) on a modest
 * interval (e.g. every 15–60 min), NOT for end users. Authentication reuses
 * the existing cron-secret mechanism and fails closed exactly like
 * /api/cron/followups: missing/mismatched secret → 401, no bypass.
 *
 * The run is bounded (per-org + org caps, short leases), tenant-scoped per
 * organization (no organizationId is accepted from the caller), executes
 * ONLY AUTO-level decisions through the existing recovery engine (no new
 * customer-facing sends), and returns an aggregate summary with no PII,
 * no conversation contents, no secrets, and no revenue claims.
 */
const bodySchema = z.object({
  perOrgLimit: z.number().int().min(1).max(SCHEDULER_MAX_PER_ORG_LIMIT).optional(),
  orgLimit: z.number().int().min(1).max(SCHEDULER_MAX_ORG_LIMIT).optional(),
  leaseMs: z.number().int().min(60_000).max(15 * 60_000).optional(),
});

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!isCronAuthorized(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  try {
    const summary = await runRecoverySchedulerBatch({
      perOrgLimit: parsed.data.perOrgLimit ?? SCHEDULER_DEFAULT_PER_ORG_LIMIT,
      orgLimit: parsed.data.orgLimit ?? SCHEDULER_DEFAULT_ORG_LIMIT,
      leaseMs: parsed.data.leaseMs ?? SCHEDULER_LEASE_MS,
    });
    return NextResponse.json(summary);
  } catch (err) {
    // Batch-level failure (not per-opportunity): report honestly, leak
    // nothing internal. Per-opportunity failures never reach here.
    console.error("[cron/recovery] batch failed");
    void err;
    return NextResponse.json({ error: "Scheduler batch failed" }, { status: 500 });
  }
}
