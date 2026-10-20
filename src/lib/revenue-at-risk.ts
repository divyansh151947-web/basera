import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  conversations,
  followUps,
  leadPropertyInterests,
  leads,
  messages,
  properties,
} from "@/db/schema";

/**
 * REVENUE-AT-RISK ENGINE (Money-First Batch 1, V1).
 *
 * Deterministic, explainable, dependency-free: NO LLM, NO training data, NO
 * external service. It combines VALUE + INTENT + INACTIVITY + FOLLOW-UP
 * FAILURE + DEAL STAGE from existing structured rows only.
 *
 * Score model (0–100). Every point comes from a triggered rule, and every
 * triggered rule emits a human-readable reason — the result always answers
 * WHY. Thresholds: 0–24 LOW, 25–49 MEDIUM, 50–74 HIGH, 75–100 CRITICAL.
 *
 * - Intent/value (max 31): lead score band (12/8/4) + HOT/WARM (6/3) +
 *   known monetary value (5) + site-visit interest (4).
 * - Inactivity (max 40): hours since last inbound LEAD message
 *   (>72:+20, >48:+14, >24:+8); never-contacted old leads (+12); hours
 *   since last outbound AI/AGENT reply (>72:+12, >48:+8, >24:+4, none:+6).
 * - Follow-up failure (max 20): overdue nextFollowUpAt (+10) + 5 per
 *   overdue PENDING follow-up (cap +10).
 * - Deal stage (max 11): stalled at an advanced stage (+6); no upcoming
 *   appointment on a worked deal (+5); conversation awaiting human (+5).
 * - Mitigators (floor 0): upcoming appointment (−8), scheduled site visit
 *   (−6, stack cap −10 with the above), inbound within 6h (−6).
 *
 * A high score with fresh engagement therefore stays LOW, while the same
 * score with days of silence plus an overdue follow-up climbs to HIGH.
 *
 * revenueAtRisk is the matched property's midpoint value, else the lead's
 * budgetMaxInr — and ONLY when the level is above LOW. No value anywhere
 * means revenueAtRisk = null (never invented). Closed (CONVERTED/LOST) or
 * opted-out leads score 0 and are excluded from organization summaries.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface LeadRiskInput {
  leadId: string;
  leadName?: string | null;
  score: number;
  temperature: "HOT" | "WARM" | "COLD";
  status: string;
  budgetMaxInr?: number | null;
  siteVisitInterest?: boolean | null;
  optedOut?: boolean;
  leadCreatedAt?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  inboundCount?: number;
  followUpOverdue?: boolean;
  overdueFollowUps?: number;
  hasUpcomingAppointment?: boolean;
  hasScheduledSiteVisit?: boolean;
  handoffAwaitingHuman?: boolean;
  assignedAgentId?: string | null;
  propertyId?: string | null;
  propertyValue?: number | null;
}

export interface LeadRiskResult {
  leadId: string;
  leadName: string | null;
  riskScore: number;
  riskLevel: RiskLevel;
  revenueAtRisk: number | null;
  reasons: string[];
  propertyId: string | null;
  propertyValue: number | null;
  leadScore: number;
  lastInteractionAt: string | null;
  followUpStatus: "OVERDUE" | "SCHEDULED" | "NONE";
  appointmentStatus: "UPCOMING" | "SITE_VISIT_SCHEDULED" | "NONE";
  calculatedAt: string;
}

export interface OrgRevenueRisk {
  totalRevenueAtRisk: number;
  evaluatedLeads: number;
  counts: Record<RiskLevel, number>;
  topRisks: LeadRiskResult[];
  /** Optional full pipeline set (same sort); off by default, used by NBA. */
  allRisks: LeadRiskResult[];
  calculatedAt: string;
}

const CLOSED_STATUSES = ["CONVERTED", "LOST"];
const ADVANCED_STATUSES = ["QUALIFIED", "INTERESTED", "NEGOTIATION", "SITE_VISIT_SCHEDULED"];

export function riskLevelForScore(score: number): RiskLevel {
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

function hoursBetween(fromIso: string, nowMs: number): number {
  return (nowMs - new Date(fromIso).getTime()) / 3_600_000;
}

function wholeDays(hours: number): number {
  return Math.max(1, Math.floor(hours / 24));
}

export function calculateLeadRevenueRisk(input: LeadRiskInput, now: Date | number = new Date()): LeadRiskResult {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const calculatedAt = new Date(nowMs).toISOString();
  const reasons: string[] = [];

  const base: Omit<LeadRiskResult, "riskScore" | "riskLevel" | "revenueAtRisk" | "reasons" | "calculatedAt"> = {
    leadId: input.leadId,
    leadName: input.leadName ?? null,
    propertyId: input.propertyId ?? null,
    propertyValue: input.propertyValue ?? input.budgetMaxInr ?? null,
    leadScore: input.score,
    lastInteractionAt: input.lastInboundAt ?? input.lastOutboundAt ?? null,
    followUpStatus: input.followUpOverdue || (input.overdueFollowUps ?? 0) > 0 ? "OVERDUE" : "NONE",
    appointmentStatus: input.hasScheduledSiteVisit
      ? "SITE_VISIT_SCHEDULED"
      : input.hasUpcomingAppointment
        ? "UPCOMING"
        : "NONE",
  };
  if (base.propertyValue != null && base.propertyValue <= 0) base.propertyValue = null;

  // Closed or opted-out pipeline rows carry no recoverable revenue.
  if (CLOSED_STATUSES.includes(input.status)) {
    return { ...base, riskScore: 0, riskLevel: "LOW", revenueAtRisk: null, reasons: [`Lead is ${input.status.toLowerCase()} — no revenue at risk.`], calculatedAt };
  }
  if (input.optedOut) {
    return { ...base, riskScore: 0, riskLevel: "LOW", revenueAtRisk: null, reasons: ["Lead opted out of follow-ups — no revenue at risk."], calculatedAt };
  }

  let score = 0;

  // --- Intent / value (max 31) ---
  if (input.score >= 80) { score += 12; reasons.push(`High lead score (${input.score}/100) signals strong buying intent.`); }
  else if (input.score >= 60) { score += 8; reasons.push(`Solid lead score (${input.score}/100) signals real interest.`); }
  else if (input.score >= 40) { score += 4; }
  if (input.temperature === "HOT") { score += 6; reasons.push("Lead is marked HOT."); }
  else if (input.temperature === "WARM") { score += 3; }
  if (base.propertyValue != null) score += 5;
  if (input.siteVisitInterest) { score += 4; reasons.push("Lead asked about a site visit."); }

  // --- Inactivity (max 40) ---
  if (input.lastInboundAt) {
    const h = hoursBetween(input.lastInboundAt, nowMs);
    if (h > 72) { score += 20; reasons.push(`No customer reply in ${wholeDays(h)} days.`); }
    else if (h > 48) { score += 14; reasons.push(`No customer reply in ${wholeDays(h)} days.`); }
    else if (h > 24) { score += 8; reasons.push("No customer reply in over a day."); }
  } else if (input.leadCreatedAt) {
    const ageH = hoursBetween(input.leadCreatedAt, nowMs);
    if (ageH > 72) { score += 12; reasons.push(`Lead has never engaged after ${wholeDays(ageH)} days.`); }
  }
  if (input.lastOutboundAt) {
    const h = hoursBetween(input.lastOutboundAt, nowMs);
    if (h > 72) { score += 12; reasons.push(`No agent response in ${wholeDays(h)} days.`); }
    else if (h > 48) { score += 8; reasons.push(`No agent response in ${wholeDays(h)} days.`); }
    else if (h > 24) { score += 4; reasons.push("No agent response in over a day."); }
  } else if (input.lastInboundAt) {
    score += 6;
    reasons.push("Customer wrote in but has no recorded agent response.");
  }

  // --- Follow-up failure (max 20) ---
  if (input.followUpOverdue) { score += 10; reasons.push("A follow-up is overdue."); }
  const overdueCount = Math.min(input.overdueFollowUps ?? 0, 2);
  if (overdueCount > 0) {
    score += overdueCount * 5;
    reasons.push(
      overdueCount > 1 ? `${overdueCount} follow-ups are overdue.` : "1 follow-up is overdue."
    );
  }

  // --- Deal stage (max 11 + conditional) ---
  if (ADVANCED_STATUSES.includes(input.status)) {
    score += 6;
    reasons.push(`Deal is stalled at stage ${input.status.replace(/_/g, " ").toLowerCase()}.`);
  }
  // No upcoming appointment matters only on a worked-but-quiet deal: an
  // advanced stage, or a strong score paired with real staleness evidence.
  // A fresh, actively-engaged lead must never be penalized for this.
  const inboundStaleHours = input.lastInboundAt ? hoursBetween(input.lastInboundAt, nowMs) : null;
  const quietEvidence =
    (input.followUpOverdue ?? false) ||
    (input.overdueFollowUps ?? 0) > 0 ||
    input.handoffAwaitingHuman ||
    (inboundStaleHours != null && inboundStaleHours > 24);
  if (!input.hasUpcomingAppointment && (ADVANCED_STATUSES.includes(input.status) || (input.score >= 60 && quietEvidence))) {
    score += 5;
    reasons.push("No upcoming appointment is scheduled.");
  }
  if (input.handoffAwaitingHuman) {
    score += 5;
    reasons.push("Conversation is waiting for a human takeover.");
  }

  // --- Mitigators (floor 0) ---
  let mitigated = 0;
  if (input.hasUpcomingAppointment) mitigated += 8;
  if (input.hasScheduledSiteVisit) mitigated += 6;
  mitigated = Math.min(mitigated, 10);
  if (input.lastInboundAt && nowMs - new Date(input.lastInboundAt).getTime() <= 6 * 3_600_000) mitigated += 6;
  score = Math.max(0, score - mitigated);
  score = Math.min(100, Math.round(score));

  const riskLevel = riskLevelForScore(score);
  if (riskLevel === "LOW" && reasons.length === 0) {
    reasons.push("Lead shows fresh engagement and no missed follow-ups.");
  }

  // Money is reported only when risk is real and a value actually exists.
  const revenueAtRisk = riskLevel !== "LOW" && base.propertyValue != null ? base.propertyValue : null;
  if (revenueAtRisk == null && riskLevel !== "LOW") {
    reasons.push("No reliable property value or budget is on file, so no amount is estimated.");
  }

  return { ...base, riskScore: score, riskLevel, revenueAtRisk, reasons, calculatedAt };
}

export interface OrgRiskOptions {
  now?: Date | number;
  /** Batch 1B-4 visibility: agents see only their own + unassigned leads. */
  assignedAgentId?: string | null;
  topLimit?: number;
  /** When true, also return the full evaluated pipeline set (for NBA). */
  includeAll?: boolean;
}

/**
 * Organization-level revenue-at-risk. Every query is organization-scoped;
 * lead rows themselves come from the caller's tenant only, so one org can
 * never observe another's pipeline. Retrieval is batched (≈7 queries total,
 * no per-lead N+1) and joined in memory.
 */
export async function getOrganizationRevenueRisk(
  organizationId: string,
  opts: OrgRiskOptions = {}
): Promise<OrgRevenueRisk> {
  const nowMs = opts.now == null ? Date.now() : typeof opts.now === "number" ? opts.now : opts.now.getTime();
  const calculatedAt = new Date(nowMs).toISOString();

  const allLeads = await db.select().from(leads).where(eq(leads.organizationId, organizationId));
  let pipeline = allLeads.filter((l) => !CLOSED_STATUSES.includes(l.status) && !l.optedOut);
  if (opts.assignedAgentId !== undefined) {
    pipeline = pipeline.filter((l) => !l.assignedAgentId || l.assignedAgentId === opts.assignedAgentId);
  }
  const leadIds = pipeline.map((l) => l.id);
  const byLeadId = new Map(pipeline.map((l) => [l.id, l]));

  if (leadIds.length === 0) {
    return { totalRevenueAtRisk: 0, evaluatedLeads: 0, counts: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }, topRisks: [], allRisks: [], calculatedAt };
  }

  const [interests, orgConversations, orgFollowUps, orgAppointments, orgProperties] = await Promise.all([
    db.select().from(leadPropertyInterests).where(inArray(leadPropertyInterests.leadId, leadIds)),
    db.select().from(conversations).where(eq(conversations.organizationId, organizationId)),
    db.select().from(followUps).where(eq(followUps.organizationId, organizationId)),
    db.select().from(appointments).where(eq(appointments.organizationId, organizationId)),
    db.select().from(properties).where(eq(properties.organizationId, organizationId)),
  ]);

  // Messages carry no organizationId themselves, so they are resolved strictly
  // through this tenant's own conversation IDs (never table-wide).
  const orgConvIds = orgConversations.map((c) => c.id);
  const orgMessages = orgConvIds.length > 0
    ? await db
        .select({ conversationId: messages.conversationId, sender: messages.sender, createdAt: messages.createdAt })
        .from(messages)
        .where(inArray(messages.conversationId, orgConvIds))
    : [];

  // Best monetary anchor per lead: top-scoring matched property midpoint,
  // else the lead's own budget ceiling (resolved to null when absent).
  const propertyById = new Map(orgProperties.map((p) => [p.id, p]));
  const bestInterestByLead = new Map<string, typeof interests[number]>();
  for (const interest of interests) {
    if (!byLeadId.has(interest.leadId)) continue; // belt & suspenders: org leads only
    const prev = bestInterestByLead.get(interest.leadId);
    if (!prev || interest.matchScore > prev.matchScore) bestInterestByLead.set(interest.leadId, interest);
  }

  const convByLead = new Map<string, typeof orgConversations[number]>();
  for (const conv of orgConversations) {
    if (!byLeadId.has(conv.leadId)) continue;
    const prev = convByLead.get(conv.leadId);
    if (!prev || conv.updatedAt > prev.updatedAt) convByLead.set(conv.leadId, conv);
  }
  const convLeadByConvId = new Map<string, string>();
  convByLead.forEach((conv, leadId) => convLeadByConvId.set(conv.id, leadId));

  const lastInboundByLead = new Map<string, string>();
  const lastOutboundByLead = new Map<string, string>();
  const inboundCountByLead = new Map<string, number>();
  for (const msg of orgMessages) {
    const leadId = convLeadByConvId.get(msg.conversationId);
    if (!leadId) continue; // message belongs to a conversation outside this evaluation set
    if (msg.sender === "LEAD") {
      inboundCountByLead.set(leadId, (inboundCountByLead.get(leadId) ?? 0) + 1);
      const prev = lastInboundByLead.get(leadId);
      if (!prev || msg.createdAt > prev) lastInboundByLead.set(leadId, msg.createdAt);
    } else if (msg.sender === "AI" || msg.sender === "AGENT") {
      const prev = lastOutboundByLead.get(leadId);
      if (!prev || msg.createdAt > prev) lastOutboundByLead.set(leadId, msg.createdAt);
    }
  }

  const overdueByLead = new Map<string, number>();
  const followUpOverdueByLead = new Map<string, boolean>();
  for (const fu of orgFollowUps) {
    if (!byLeadId.has(fu.leadId)) continue;
    if (fu.status === "PENDING" && fu.scheduledFor <= calculatedAt) {
      overdueByLead.set(fu.leadId, (overdueByLead.get(fu.leadId) ?? 0) + 1);
      followUpOverdueByLead.set(fu.leadId, true);
    }
  }

  const upcomingByLead = new Map<string, boolean>();
  const siteVisitByLead = new Map<string, boolean>();
  for (const appt of orgAppointments) {
    if (!byLeadId.has(appt.leadId)) continue;
    if (["SCHEDULED", "CONFIRMED"].includes(appt.status) && appt.scheduledAt >= calculatedAt) {
      upcomingByLead.set(appt.leadId, true);
      if (appt.type === "SITE_VISIT") siteVisitByLead.set(appt.leadId, true);
    }
  }

  const results: LeadRiskResult[] = pipeline.map((lead) => {
    const interest = bestInterestByLead.get(lead.id);
    const property = interest ? propertyById.get(interest.propertyId) : undefined;
    const propertyValue =
      property && property.priceMinInr != null && property.priceMaxInr != null
        ? Math.round((property.priceMinInr + property.priceMaxInr) / 2)
        : null;
    const conv = convByLead.get(lead.id);
    return calculateLeadRevenueRisk(
      {
        leadId: lead.id,
        leadName: lead.name,
        score: lead.score ?? 0,
        temperature: (lead.temperature ?? "COLD") as "HOT" | "WARM" | "COLD",
        status: lead.status,
        budgetMaxInr: lead.budgetMaxInr,
        siteVisitInterest: lead.siteVisitInterest,
        optedOut: lead.optedOut,
        leadCreatedAt: lead.createdAt,
        lastInboundAt: lastInboundByLead.get(lead.id) ?? null,
        lastOutboundAt: lastOutboundByLead.get(lead.id) ?? null,
        inboundCount: inboundCountByLead.get(lead.id) ?? 0,
        followUpOverdue: followUpOverdueByLead.get(lead.id) ?? (lead.nextFollowUpAt != null && lead.nextFollowUpAt <= calculatedAt),
        overdueFollowUps: overdueByLead.get(lead.id) ?? 0,
        hasUpcomingAppointment: upcomingByLead.get(lead.id) ?? false,
        hasScheduledSiteVisit: siteVisitByLead.get(lead.id) ?? false,
        handoffAwaitingHuman: conv?.status === "HUMAN_HANDLING",
        assignedAgentId: lead.assignedAgentId,
        propertyId: property?.id ?? null,
        propertyValue,
      },
      nowMs
    );
  });

  const counts: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  let totalRevenueAtRisk = 0;
  for (const r of results) {
    counts[r.riskLevel] += 1;
    if (r.revenueAtRisk != null) totalRevenueAtRisk += r.revenueAtRisk;
  }
  const topLimit = opts.topLimit ?? 20;
  const ranked = [...results].sort(
    (a, b) =>
      (b.revenueAtRisk ?? -1) - (a.revenueAtRisk ?? -1) || b.riskScore - a.riskScore
  );
  const topRisks = ranked.filter((r) => r.riskLevel !== "LOW").slice(0, topLimit);

  return { totalRevenueAtRisk, evaluatedLeads: results.length, counts, topRisks, allRisks: opts.includeAll ? ranked : [], calculatedAt };
}
