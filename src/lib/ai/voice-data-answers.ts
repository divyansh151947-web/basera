import "server-only";
import { formatInr } from "@/lib/formatters";
import { getOrganizationRevenueRisk } from "@/lib/revenue-at-risk";
import { getOrganizationNextBestActions, type NextBestAction } from "@/lib/next-best-action";
import { getRecoveryAutopilot } from "@/lib/revenue-recovery-autopilot";
import { getDashboardCounts } from "@/lib/data/leads";
import { listAppointments } from "@/lib/data/org";
import type { DetectedVoiceLanguage } from "./voice-language";

/**
 * VOICE DATA ANSWERS (read-only, additive).
 *
 * Answers factual questions ("What is my revenue at risk?", "Which leads
 * need follow-up?") with REAL engine data — never invented. Used ONLY to
 * append one grounded line to the normal AI reply inside voice turns; the
 * Basera pipeline (extraction/qualification/matching/scoring) is untouched.
 *
 * Honesty rules inherited from the engines: recovered revenue is never
 * stated (the schema records no payment evidence); amounts shown are
 * recorded opportunity values / risk estimates, worded as such.
 */

export type VoiceDataIntent =
  | "revenue_at_risk"
  | "recovery_attention"
  | "followups_due"
  | "next_best_action"
  | "appointments_upcoming";

const NAVIGATE_AWAY_RE =
  /^\s*(open|kholo|kholiye|go to|go|take me to|show)\s+(my\s+|the\s+)?(follow.?ups?|recovery|analytics)\s*[?.!]*\s*$/i;

export function detectVoiceDataIntent(rawText: string): VoiceDataIntent | null {
  const text = (rawText ?? "").trim();
  if (!text) return null;

  if (/revenue\s+at\s+risk|at.risk.*revenue|revenue.*जोखिम|जोखिम.*revenue/i.test(text)) {
    return "revenue_at_risk";
  }
  if (NAVIGATE_AWAY_RE.test(text)) return null;
  // Follow-up specificity wins over the generic attention bucket below
  // ("Which leads need follow-up?" is a follow-up question, not recovery).
  if (
    /follow.?ups?.*(due|pending|overdue|baki|baaki|kitn[ei]|kab|which|kaun|kya|need|require)|which leads need follow|follow up.*(kab|when|due)/i.test(
      text
    )
  ) {
    return "followups_due";
  }
  if (
    /leads?\s+(need|needs|needing|require).*(attention|action)|which leads|konse leads?|kaun\s?se leads?|leads?.*dhyaan|attention.*leads?|recovery opportunit|leads?\s+at\s+risk/i.test(
      text
    )
  ) {
    return "recovery_attention";
  }
  if (
    /what should i do|next best|highest priority|top priorit|priority.*leads?|which lead.*(contact|call|first)|sabse.*(pehle|pehla|important)|pehle.*(call|contact|kisse)|kisse.*(call|contact).*karoon|kisse.*baat karoon/i.test(
      text
    )
  ) {
    return "next_best_action";
  }
  if (
    /(my|upcoming|scheduled|kitn[i|e]|kab|when|list|kaunsi|kaunse).*(appointment|site visit)|appointments?.*(kab|when|kitn[i|e]|list|scheduled|upcoming)|site visit.*(kab|when|kitni|scheduled)/i.test(
      text
    )
  ) {
    return "appointments_upcoming";
  }
  return null;
}

const NBA_ACTION_PHRASE: Record<NextBestAction, { en: string; hi: string; hinglish: string }> = {
  RESPOND_TO_CUSTOMER: { en: "respond to the customer", hi: "grahak ko jawab dein", hinglish: "customer ko respond karo" },
  FOLLOW_UP: { en: "follow up", hi: "follow-up karein", hinglish: "follow up karo" },
  BOOK_SITE_VISIT: { en: "book a site visit", hi: "site visit book karein", hinglish: "site visit book karo" },
  CONFIRM_SITE_VISIT: { en: "confirm the site visit", hi: "site visit confirm karein", hinglish: "site visit confirm karo" },
  FOLLOW_UP_AFTER_SITE_VISIT: { en: "follow up after the site visit", hi: "site visit ke baad follow-up karein", hinglish: "site visit ke baad follow up karo" },
  REACTIVATE_LEAD: { en: "re-engage the lead", hi: "lead se dobara sampark karein", hinglish: "lead ko dobara engage karo" },
  FIND_BETTER_PROPERTY: { en: "find a better property match", hi: "behtar property match dhoondhein", hinglish: "better property match dhoondho" },
  ESCALATE_TO_MANAGER: { en: "escalate to a manager", hi: "manager ko escalate karein", hinglish: "manager ko escalate karo" },
  HANDOFF_TO_HUMAN: { en: "hand over to a human agent", hi: "human agent ko handoff karein", hinglish: "human agent ko handoff karo" },
  WAIT_AND_MONITOR: { en: "wait and monitor", hi: "intezaar karein aur nazar rakhein", hinglish: "wait karo aur monitor karo" },
  NO_ACTION: { en: "hold steady — no action needed", hi: "rukein — abhi koi action zaroori nahi", hinglish: "hold karo — abhi koi action nahi chahiye" },
};

function leadLabel(name: string | null): string {
  return name && name.trim() ? name.trim() : "An unnamed lead";
}

function formatApptDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ", " +
      d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

export interface VoiceDataAnswerInput {
  intent: VoiceDataIntent;
  organizationId: string;
  language: DetectedVoiceLanguage;
}

/** Pure formatter: engine result objects → localized grounded line. Exported for tests. */
export function formatVoiceDataAnswer(
  intent: VoiceDataIntent,
  language: DetectedVoiceLanguage,
  data: {
    totalRevenueAtRisk?: number;
    criticalCount?: number;
    attentionLeads?: { name: string | null }[];
    followUpsDue?: number;
    nextAction?: { leadName: string | null; action: NextBestAction } | null;
    upcomingCount?: number;
    nextApptLabel?: string | null;
  }
): string {
  const hi = language === "hi";
  const hinglish = language === "hinglish";
  switch (intent) {
    case "revenue_at_risk": {
      const amount = formatInr(data.totalRevenueAtRisk ?? 0);
      const crit = data.criticalCount ?? 0;
      if (hi) return `Record ke hisaab se abhi ${amount} revenue at risk hai, jismein ${crit} critical leads hain. Ye anumanit jokhim hai, guarantee nahi.`;
      if (hinglish) return `Record ke hisaab se abhi ${amount} revenue at risk hai, with ${crit} critical leads. Ye estimate hai, guarantee nahi.`;
      return `On record right now, ${amount} is at risk across your pipeline, including ${crit} critical leads. That's a risk estimate, not guaranteed revenue.`;
    }
    case "recovery_attention": {
      const names = (data.attentionLeads ?? []).slice(0, 3).map((l) => leadLabel(l.name));
      if (names.length === 0) {
        if (hi) return "Abhi koi aisa lead nazar nahi aa raha jise turant dhyaan chahiye.";
        if (hinglish) return "Abhi koi aisa lead nahi dikh raha jise urgent attention chahiye.";
        return "Right now no lead looks like it needs urgent attention.";
      }
      const list = names.join(", ");
      if (hi) return `In leads par dhyaan dein: ${list}. Poori list Recovery section mein hai.`;
      if (hinglish) return `In leads par dhyaan do: ${list}. Full list Recovery section mein hai.`;
      return `These leads need attention first: ${list}. The full list is in the Recovery section.`;
    }
    case "followups_due": {
      const n = data.followUpsDue ?? 0;
      if (n === 0) {
        if (hi) return "Abhi koi follow-up baaki nahi hai. Sab up to date hai.";
        if (hinglish) return "Abhi koi follow-up due nahi hai. Sab up to date hai.";
        return "No follow-ups are due right now. Everything is up to date.";
      }
      if (hi) return `${n} follow-up${n === 1 ? "" : "s"} baaki ${n === 1 ? "hai" : "hain"}. Dashboard par poori list dekh sakte hain.`;
      if (hinglish) return `${n} follow-ups due ${n === 1 ? "hai" : "hain"}. Full list Dashboard par hai.`;
      return `${n} follow-up${n === 1 ? " is" : "s are"} due. The full list is on your dashboard.`;
    }
    case "next_best_action": {
      const a = data.nextAction;
      if (!a) {
        if (hi) return "Abhi pipeline shaant hai — koi turant action zaroori nahi lag raha.";
        if (hinglish) return "Abhi pipeline shaant hai — koi urgent action nahi dikh raha.";
        return "Your pipeline looks quiet — no urgent action stands out right now.";
      }
      const phrase = NBA_ACTION_PHRASE[a.action][hi ? "hi" : hinglish ? "hinglish" : "en"];
      const who = leadLabel(a.leadName);
      if (hi) return `Sabse pehle ${who} se sampark karein — agla kadam: ${phrase}.`;
      if (hinglish) return `Sabse pehle ${who} ko contact karo — next step: ${phrase}.`;
      return `Contact ${who} first — next step: ${phrase}.`;
    }
    case "appointments_upcoming": {
      const n = data.upcomingCount ?? 0;
      if (n === 0) {
        if (hi) return "Abhi koi upcoming appointment schedule nahi hai.";
        if (hinglish) return "Abhi koi upcoming appointments schedule nahi hain.";
        return "You have no upcoming appointments scheduled.";
      }
      const when = data.nextApptLabel ? ` Agli appointment: ${data.nextApptLabel}.` : "";
      if (hi) return `Aapki ${n} upcoming appointment${n === 1 ? "" : "s"} hain.${when}`;
      if (hinglish) return `Aapki ${n} upcoming appointments hain.${when}`;
      return `You have ${n} upcoming appointment${n === 1 ? "" : "s"}.${when}`;
    }
  }
}

/** Fetch real engine data and format one grounded answer line. Null on any failure. */
export async function buildVoiceDataAnswer(input: VoiceDataAnswerInput): Promise<string | null> {
  try {
    switch (input.intent) {
      case "revenue_at_risk": {
        const risk = await getOrganizationRevenueRisk(input.organizationId);
        return formatVoiceDataAnswer(input.intent, input.language, {
          totalRevenueAtRisk: risk.totalRevenueAtRisk,
          criticalCount: risk.counts.CRITICAL,
        });
      }
      case "recovery_attention": {
        const auto = await getRecoveryAutopilot(input.organizationId, { limit: 5 });
        return formatVoiceDataAnswer(input.intent, input.language, {
          attentionLeads: auto.leaks.slice(0, 3).map((l) => ({ name: l.leadName })),
        });
      }
      case "followups_due": {
        const counts = await getDashboardCounts(input.organizationId);
        return formatVoiceDataAnswer(input.intent, input.language, { followUpsDue: counts.followUpsDue });
      }
      case "next_best_action": {
        const nba = await getOrganizationNextBestActions(input.organizationId, { limit: 5 });
        const top = nba.actions[0] ?? null;
        return formatVoiceDataAnswer(input.intent, input.language, {
          nextAction: top ? { leadName: top.leadName, action: top.action } : null,
        });
      }
      case "appointments_upcoming": {
        const rows = await listAppointments(input.organizationId);
        const now = Date.now();
        const upcoming = rows.filter((r) => {
          const t = new Date((r as { scheduledAt?: unknown }).scheduledAt as string).getTime();
          return Number.isFinite(t) && t >= now - 60_000;
        });
        const nextLabel = upcoming.length > 0
          ? formatApptDate((upcoming[0] as { scheduledAt?: unknown }).scheduledAt)
          : null;
        return formatVoiceDataAnswer(input.intent, input.language, {
          upcomingCount: upcoming.length,
          nextApptLabel: nextLabel,
        });
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
