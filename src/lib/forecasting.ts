import "server-only";
import { db } from "@/db/client";
import { leads, leadPropertyInterests, properties, users } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { opportunityValueFor } from "./revenue-recovery-autopilot";

/**
 * SALES FORECASTING SERVICE (Feature 6).
 *
 * Deterministic, explainable pipeline forecasting built exclusively on
 * existing CRM records. No invented probabilities, no guaranteed-revenue
 * claims, no LLM business decisions.
 *
 * Method:
 *  - Each open lead carries an opportunity value anchor (best matched
 *    property midpoint, else the lead's budgetMaxInr, else null).
 *  - Each lead's stage maps to a configured conversion probability
 *    (defaults documented below; overridable per request, never persisted
 *    without an explicit forecast_configs table).
 *  - Weighted pipeline = sum(opportunity * probability).
 *  - Expected closures = sum(probability) across open leads (expected
 *    count of conversions, not a promise).
 *  - Expected revenue = sum(opportunity * probability).
 *  - Historical conversion = converted leads / evaluated leads in the
 *    lookback window, only when sufficient history exists.
 *
 * Honesty rules:
 *  - A lead with no opportunity value is counted in pipeline volume but
 *    contributes ₹0 to weighted value (never invented).
 *  - Confidence reflects data volume, not model certainty.
 *  - "Forecast" is always labelled an estimate, never confirmed revenue.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default stage-to-probability mapping (percent). Aligned with the
 *  existing pipeline stages in src/lib/pipeline.ts. Weighted early stages
 *  conservatively; late stages reflect that a deal in negotiation is far
 *  more likely to close than a new enquiry. */
export const DEFAULT_STAGE_PROBABILITIES: Record<string, number> = {
  NEW: 5,
  CONTACTED: 10,
  QUALIFIED: 25,
  INTERESTED: 40,
  SITE_VISIT_SCHEDULED: 60,
  NEGOTIATION: 80,
  CONVERTED: 100,
  LOST: 0,
  NURTURE: 10,
};

export type ForecastConfidence = "LOW" | "MEDIUM" | "HIGH";

/** Minimum closed leads in the lookback window before a historical
 *  conversion rate is treated as meaningful. */
const MIN_CLOSED_FOR_HISTORY = 10;
/** Lookback window (days) for historical conversion and trend analysis. */
const HISTORY_LOOKBACK_DAYS = 90;

/** Pipeline stages that count as "open" (not terminal). */
const OPEN_STATUSES = new Set([
  "NEW", "CONTACTED", "QUALIFIED", "INTERESTED",
  "SITE_VISIT_SCHEDULED", "NEGOTIATION", "NURTURE",
]);
const STAGE_ORDER = ["NEW", "CONTACTED", "QUALIFIED", "INTERESTED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "NURTURE"];

export interface StageProbabilityOverride {
  stage: string;
  probability: number;
}

export interface ForecastOptions {
  asOf?: Date | number;
  /** Optional per-stage probability overrides (0-100). Not persisted. */
  stageProbabilities?: StageProbabilityOverride[];
  /** Agent-scoped view (own + unassigned leads). Omit for org-wide. */
  assignedAgentId?: string | null;
  lookbackDays?: number;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineStageRow {
  stage: string;
  label: string;
  probability: number;
  leadCount: number;
  value: number; // sum of opportunity values (nulls excluded)
  weightedValue: number; // sum(opportunity * probability)
  weightedLeads: number; // sum of probabilities (expected conversions)
}

export interface AgentForecastRow {
  agentId: string;
  agentName: string;
  openLeadCount: number;
  pipelineValue: number;
  weightedPipelineValue: number;
  expectedRevenue: number;
}

export interface MonthlyTrendRow {
  month: string; // YYYY-MM
  leadsCreated: number;
  leadsConverted: number;
  valueCreated: number;
}

export interface ForecastResult {
  generatedAt: string;
  asOf: string;
  organizationId: string;
  scopedToAgentId: string | null;
  // Headline pipeline
  openLeadCount: number;
  pipelineValue: number;
  weightedPipelineValue: number;
  expectedClosures: number;
  expectedRevenue: number;
  // By stage
  pipelineByStage: PipelineStageRow[];
  // Confidence & history
  forecastConfidence: ForecastConfidence;
  confidenceReasons: string[];
  historicalConversionRate: number; // percent, 0 when insufficient
  historicalConversionRateNull: boolean;
  evaluatedLeads: number;
  closedLeadsInWindow: number;
  hasSufficientHistory: boolean;
  honestyNote: string;
  // Breakdowns
  agentForecasts: AgentForecastRow[];
  monthlyTrends: MonthlyTrendRow[];
  // Value on file coverage
  leadsWithValue: number;
  leadsWithoutValue: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    NEW: "New",
    CONTACTED: "Contacted",
    QUALIFIED: "Qualified",
    INTERESTED: "Property Shortlisted",
    SITE_VISIT_SCHEDULED: "Site Visit",
    NEGOTIATION: "Negotiation",
    CONVERTED: "Won",
    LOST: "Lost",
    NURTURE: "Nurture",
  };
  return labels[stage] ?? stage;
}

function getProbability(stage: string, probabilities: Record<string, number>): number {
  if (stage in probabilities) return probabilities[stage];
  // Unknown stage: conservative default, never invent optimism.
  return 10;
}

function toMonth(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Main calculation
// ---------------------------------------------------------------------------

export async function calculateForecast(
  organizationId: string,
  opts: ForecastOptions = {}
): Promise<ForecastResult> {
  const nowMs = opts.asOf == null ? Date.now() : typeof opts.asOf === "number" ? opts.asOf : opts.asOf.getTime();
  const asOf = new Date(nowMs).toISOString();
  const lookbackDays = opts.lookbackDays ?? HISTORY_LOOKBACK_DAYS;
  const since = new Date(nowMs - lookbackDays * 86_400_000).toISOString();

  // Resolve stage probabilities: defaults first, then per-request overrides.
  const probabilities = { ...DEFAULT_STAGE_PROBABILITIES };
  if (opts.stageProbabilities) {
    for (const o of opts.stageProbabilities) {
      const p = Math.max(0, Math.min(100, Math.round(Number(o.probability))));
      if (!Number.isNaN(p)) probabilities[o.stage] = p;
    }
  }

  const scope = opts.assignedAgentId !== undefined ? { assignedAgentId: opts.assignedAgentId } : {};

  // Batched org-scoped reads (no per-lead N+1).
  const [leadRows, teamRows, props] = await Promise.all([
    db.select().from(leads).where(eq(leads.organizationId, organizationId)),
    db.select().from(users).where(eq(users.organizationId, organizationId)),
    db.select().from(properties).where(eq(properties.organizationId, organizationId)),
  ]);

  const propertyById = new Map<string, (typeof properties.$inferSelect)>();
  for (const p of props) propertyById.set(p.id, p);

  const leadIds = leadRows.map((l) => l.id);
  const leadInterests =
    leadIds.length > 0
      ? await db.select().from(leadPropertyInterests).where(inArray(leadPropertyInterests.leadId, leadIds))
      : [];

  // Best matched property per lead (highest match score), then its midpoint.
  const bestMidpointByLead = new Map<string, number | null>();
  for (const lead of leadRows) {
    const leadInterestsFiltered = leadInterests.filter((i) => i.leadId === lead.id);
    let best: { matchScore: number; propertyId: string } | null = null;
    for (const i of leadInterestsFiltered) {
      if (!best || i.matchScore > best.matchScore) best = { matchScore: i.matchScore, propertyId: i.propertyId };
    }
    let midpoint: number | null = null;
    if (best) {
      const prop = propertyById.get(best.propertyId);
      if (prop && prop.priceMinInr != null && prop.priceMaxInr != null) {
        midpoint = Math.round((prop.priceMinInr + prop.priceMaxInr) / 2);
      }
    }
    bestMidpointByLead.set(lead.id, midpoint);
  }

  const visibleLeads =
    opts.assignedAgentId !== undefined
      ? leadRows.filter((l) => !l.assignedAgentId || l.assignedAgentId === opts.assignedAgentId)
      : leadRows;
  const agentNameById = new Map(teamRows.map((u) => [u.id, u.name]));

  // Closed leads (for historical conversion within the window).
  const closedRows = leadRows.filter((l) => l.status === "CONVERTED" || l.status === "LOST");

  // -----------------------------------------------------------------------
  // Build per-stage rows
  // -----------------------------------------------------------------------
  const stageRows = new Map<string, PipelineStageRow>();
  for (const s of STAGE_ORDER) {
    stageRows.set(s, {
      stage: s,
      label: stageLabel(s),
      probability: getProbability(s, probabilities),
      leadCount: 0,
      value: 0,
      weightedValue: 0,
      weightedLeads: 0,
    });
  }

  let pipelineValue = 0;
  let weightedPipelineValue = 0;
  let expectedClosures = 0;
  let expectedRevenue = 0;
  let leadsWithValue = 0;
  let leadsWithoutValue = 0;

  const agentForecastMap = new Map<string, AgentForecastRow>();

  for (const lead of visibleLeads) {
    if (!OPEN_STATUSES.has(lead.status)) continue;
    const opportunity = opportunityValueFor(bestMidpointByLead.get(lead.id) ?? null, lead.budgetMaxInr ?? null);
    const probability = getProbability(lead.status, probabilities);
    const weighted = opportunity != null ? Math.round(opportunity * (probability / 100)) : 0;

    const row = stageRows.get(lead.status);
    if (row) {
      row.leadCount += 1;
      if (opportunity != null) {
        row.value += opportunity;
        leadsWithValue += 1;
      } else {
        leadsWithoutValue += 1;
      }
      row.weightedValue += weighted;
      row.weightedLeads += probability / 100;
    }

    pipelineValue += opportunity != null ? opportunity : 0;
    weightedPipelineValue += weighted;
    expectedClosures += probability / 100;
    expectedRevenue += weighted;

    // Agent rollup (only assigned leads; unassigned roll up to org but no
    // single agent).
    if (lead.assignedAgentId) {
      const existing =
        agentForecastMap.get(lead.assignedAgentId) ?? {
          agentId: lead.assignedAgentId,
          agentName: agentNameById.get(lead.assignedAgentId) ?? "Unnamed agent",
          openLeadCount: 0,
          pipelineValue: 0,
          weightedPipelineValue: 0,
          expectedRevenue: 0,
        };
      existing.openLeadCount += 1;
      if (opportunity != null) existing.pipelineValue += opportunity;
      existing.weightedPipelineValue += weighted;
      existing.expectedRevenue += weighted;
      agentForecastMap.set(lead.assignedAgentId, existing);
    }
  }

  const pipelineByStage = STAGE_ORDER
    .map((s) => stageRows.get(s)!)
    .filter((r) => r.leadCount > 0 || r.value > 0 || r.weightedValue > 0);

  // -----------------------------------------------------------------------
  // Historical conversion (only when sufficient history)
  // -----------------------------------------------------------------------
  const leadsInWindow = leadRows.filter((l) => new Date(l.createdAt).getTime() >= new Date(since).getTime());
  const convertedInWindow = closedRows.filter(
    (l) => l.status === "CONVERTED" && new Date(l.updatedAt).getTime() >= new Date(since).getTime()
  );

  const evaluatedLeads = leadsInWindow.length;
  const closedLeadsInWindow = closedRows.filter(
    (l) => new Date(l.updatedAt).getTime() >= new Date(since).getTime()
  ).length;

  let historicalConversionRate: number | null = null;
  let hasSufficientHistory = false;
  const confidenceReasons: string[] = [];

  if (convertedInWindow.length >= MIN_CLOSED_FOR_HISTORY && evaluatedLeads > 0) {
    historicalConversionRate = Number(((convertedInWindow.length / evaluatedLeads) * 100).toFixed(1));
    hasSufficientHistory = true;
    confidenceReasons.push(`${convertedInWindow.length} conversions in the last ${lookbackDays} days — historical basis present.`);
  } else if (evaluatedLeads > 0) {
    confidenceReasons.push(`Only ${convertedInWindow.length} conversion${convertedInWindow.length === 1 ? "" : "s"} in the last ${lookbackDays} days — historical rate is not statistically meaningful.`);
  } else {
    confidenceReasons.push("No leads created in the lookback window — no historical basis available.");
  }

  // -----------------------------------------------------------------------
  // Confidence: data volume driven, not model certainty.
  // -----------------------------------------------------------------------
  let forecastConfidence: ForecastConfidence = "LOW";
  if (hasSufficientHistory && visibleLeads.length >= 20) {
    forecastConfidence = "HIGH";
    confidenceReasons.push("Sufficient conversion history and pipeline volume for a meaningful estimate.");
  } else if (hasSufficientHistory || visibleLeads.length >= 10) {
    forecastConfidence = "MEDIUM";
    confidenceReasons.push("Limited history or modest pipeline volume — treat the estimate as directional.");
  } else {
    confidenceReasons.push("Insufficient pipeline volume and history — the weighted pipeline is the most reliable figure.");
  }

  // -----------------------------------------------------------------------
  // Agent forecasts
  // -----------------------------------------------------------------------
  const agentForecasts = Array.from(agentForecastMap.values()).sort(
    (a, b) => b.expectedRevenue - a.expectedRevenue || b.pipelineValue - a.pipelineValue
  );

  // -----------------------------------------------------------------------
  // Monthly trends (created vs converted over the lookback window)
  // -----------------------------------------------------------------------
  const trendMap = new Map<string, MonthlyTrendRow>();
  for (const lead of leadRows) {
    const month = toMonth(lead.createdAt);
    if (!month) continue;
    if (!trendMap.has(month)) trendMap.set(month, { month, leadsCreated: 0, leadsConverted: 0, valueCreated: 0 });
    const row = trendMap.get(month)!;
    row.leadsCreated += 1;
    const opportunity = opportunityValueFor(bestMidpointByLead.get(lead.id) ?? null, lead.budgetMaxInr ?? null);
    row.valueCreated += opportunity != null ? opportunity : 0;
  }
  for (const lead of closedRows) {
    if (lead.status !== "CONVERTED") continue;
    const month = toMonth(lead.updatedAt);
    if (!month) continue;
    if (!trendMap.has(month)) trendMap.set(month, { month, leadsCreated: 0, leadsConverted: 0, valueCreated: 0 });
    trendMap.get(month)!.leadsConverted += 1;
  }
  const monthlyTrends = Array.from(trendMap.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);

  const expectedClosuresRounded = Math.round(expectedClosures * 10) / 10;

  const honestyNote =
    "This forecast is a statistical estimate derived from recorded CRM activity, not a guarantee of revenue. " +
    "Weighted pipeline applies stage probabilities to opportunity values on file; leads with no value on file " +
    "contribute zero. Confidence reflects the volume of historical conversion data, not the likelihood any " +
    "individual deal will close.";

  return {
    generatedAt: new Date(nowMs).toISOString(),
    asOf,
    organizationId,
    scopedToAgentId: opts.assignedAgentId ?? null,
    openLeadCount: visibleLeads.filter((l) => OPEN_STATUSES.has(l.status)).length,
    pipelineValue,
    weightedPipelineValue,
    expectedClosures: expectedClosuresRounded,
    expectedRevenue,
    pipelineByStage,
    forecastConfidence,
    confidenceReasons,
    historicalConversionRate: historicalConversionRate ?? 0,
    historicalConversionRateNull: historicalConversionRate == null,
    evaluatedLeads,
    closedLeadsInWindow,
    hasSufficientHistory,
    honestyNote,
    agentForecasts,
    monthlyTrends,
    leadsWithValue,
    leadsWithoutValue,
  };
}
