import "server-only";
import { isPostgresDatabaseUrl } from "@/db/dialect";
import { getAIConfig, getOrganization, listTeam } from "./data/org";
import { getWhatsAppIntegration } from "./data/integrations";
import { listProperties } from "./data/properties";
import { getDashboardCounts } from "./data/leads";

/**
 * PILOT READINESS (Batch 8 Prompt 4).
 *
 * A lightweight, read-only checklist answering "is this workspace ready for
 * a real brokerage pilot?" Every check reads existing rows/config the app
 * already owns — no new data model, no new pipeline, no AI calls.
 *
 * SAFETY RULES (load-bearing):
 * - Status values only: "Configured" / "Not configured" / "Action required"
 *   / "Available". NEVER secret values, keys, tokens, passwords, URLs with
 *   credentials, phone-number IDs, or any credential material.
 * - Tenant-scoped: every row read is filtered by the caller's
 *   organizationId. The environment half (database/redis/email/app-url/cron
 *   presence) is deployment-global booleans only, surfaced on the
 *   admin-gated settings page — never to agents, never with values.
 */

export type ReadinessStatus = "ready" | "action" | "info";

export interface ReadinessCheck {
  key: string;
  label: string;
  status: ReadinessStatus;
  /** Safe status text: "Configured" | "Not configured" | "Action required" | "Available". */
  statusLabel: string;
  /** Factual, PII-free detail (counts and page hints only). */
  detail: string;
  href?: string;
}

export interface ReadinessSection {
  key: string;
  title: string;
  checks: ReadinessCheck[];
}

export interface PilotReadiness {
  calculatedAt: string;
  organizationId: string;
  organizationName: string | null;
  sections: ReadinessSection[];
  readyCount: number;
  actionCount: number;
}

export interface ProductionStatus {
  database: boolean;
  databaseLabel: string;
  redis: boolean;
  redisLabel: string;
  email: boolean;
  emailLabel: string;
  appUrl: boolean;
  appUrlLabel: string;
  cron: boolean;
  cronLabel: string;
}

const nonEmpty = (v: string | undefined): boolean => v != null && v.trim().length > 0;

/**
 * Deployment-global environment presence. Accepts an env mapping so tests
 * can exercise the full matrix without touching process.env. Returns
 * booleans only — callers map them to "Configured"/"Not configured" labels.
 * Presence semantics mirror the consumers: email.ts (SMTP host or Resend
 * key), rate-limit-redis (Upstash URL), cron routes (CRON_SECRET).
 */
export function getProductionStatus(env: Record<string, string | undefined> = process.env): ProductionStatus {
  const database = isPostgresDatabaseUrl(env.DATABASE_URL);
  const redis = nonEmpty(env.UPSTASH_REDIS_REST_URL);
  const email = nonEmpty(env.SMTP_HOST) || nonEmpty(env.RESEND_API_KEY);
  const appUrl = nonEmpty(env.APP_URL) || nonEmpty(env.NEXTAUTH_URL);
  const cron = nonEmpty(env.CRON_SECRET);
  return {
    database,
    databaseLabel: database ? "Configured" : "Not configured",
    redis,
    redisLabel: redis ? "Configured" : "Not configured",
    email,
    emailLabel: email ? "Configured" : "Not configured",
    appUrl,
    appUrlLabel: appUrl ? "Configured" : "Not configured",
    cron,
    cronLabel: cron ? "Configured" : "Not configured",
  };
}

function ready(key: string, label: string, detail: string, href?: string): ReadinessCheck {
  return { key, label, status: "ready", statusLabel: "Configured", detail, href };
}

function action(key: string, label: string, detail: string, href?: string): ReadinessCheck {
  return { key, label, status: "action", statusLabel: "Action required", detail, href };
}

function info(key: string, label: string, detail: string, href?: string): ReadinessCheck {
  return { key, label, status: "info", statusLabel: "Available", detail, href };
}

/**
 * Workspace readiness for one organization. All row reads are
 * organization-scoped; the production section reuses getProductionStatus
 * (booleans only). Bounded reads via existing data-access helpers.
 */
export async function getPilotReadiness(
  organizationId: string,
  env: Record<string, string | undefined> = process.env
): Promise<PilotReadiness> {
  const calculatedAt = new Date().toISOString();
  const [org, team, properties, counts, aiConfig, whatsapp] = await Promise.all([
    getOrganization(organizationId),
    listTeam(organizationId),
    listProperties(organizationId),
    getDashboardCounts(organizationId),
    getAIConfig(organizationId),
    getWhatsAppIntegration(organizationId).catch(() => null),
  ]);
  const prod = getProductionStatus(env);

  const usableProperties = properties.filter(
    (p) => !p.isArchived && p.availability !== "SOLD_OUT" && (p.city ?? "").trim().length > 0 && (p.priceMaxInr ?? 0) > 0
  );
  let followUpRulesOk = false;
  try {
    const rules = aiConfig?.followUpRulesJson ? JSON.parse(aiConfig.followUpRulesJson) : null;
    followUpRulesOk = Array.isArray(rules?.intervalsDays) && rules.intervalsDays.length > 0;
  } catch {
    followUpRulesOk = false;
  }
  const whatsappReady = Boolean(whatsapp?.integration?.isEnabled) && whatsapp?.config?.phoneNumberId != null;

  const sections: ReadinessSection[] = [
    {
      key: "account",
      title: "Account",
      checks: [
        org
          ? ready("workspace", "Workspace", `Configured${org.name ? ` — ${org.name}` : ""}.`, "/settings")
          : action("workspace", "Workspace", "Not configured — workspace record is missing.", "/settings"),
        team.some((m) => m.role === "BUSINESS_ADMIN")
          ? ready("admin", "Admin account", "Configured — a workspace admin exists.", "/team")
          : action("admin", "Admin account", "Not configured — assign a workspace admin.", "/team"),
      ],
    },
    {
      key: "data",
      title: "Data",
      checks: [
        properties.length > 0
          ? ready("properties", "Properties", `Configured — ${properties.length} propert${properties.length === 1 ? "y" : "ies"} in inventory.`, "/properties")
          : action("properties", "Properties", "Not configured — add at least one property.", "/properties"),
        usableProperties.length > 0
          ? ready(
              "property-info",
              "Property information",
              `Configured — ${usableProperties.length} of ${properties.length} with city and price (usable for matching).`,
              "/properties"
            )
          : action(
              "property-info",
              "Property information",
              "Not configured — properties need a city and a price to be matched.",
              "/properties"
            ),
        counts.total > 0
          ? ready("leads", "Leads", `Configured — ${counts.total} lead${counts.total === 1 ? "" : "s"} in the CRM.`, "/leads")
          : info("leads", "Leads", "Available — no leads yet. Share website chat to receive enquiries.", "/leads"),
      ],
    },
    {
      key: "channels",
      title: "Channels",
      checks: [
        info("website-chat", "Website chat", "Available — built-in, no configuration needed.", "/conversations"),
        whatsappReady
          ? ready("whatsapp", "WhatsApp", "Configured — WhatsApp integration is enabled.", "/settings")
          : action("whatsapp", "WhatsApp", "Not configured — connect WhatsApp in settings to use it.", "/settings"),
        prod.email
          ? ready("email", "Email", "Configured — outbound email is available.", "/settings")
          : action("email", "Email", "Not configured — configure email if the pilot requires it.", "/settings"),
      ],
    },
    {
      key: "automation",
      title: "Automation",
      checks: [
        aiConfig && aiConfig.greeting && aiConfig.tone
          ? ready("ai-config", "AI configuration", "Configured — greeting and tone are set.", "/settings")
          : action("ai-config", "AI configuration", "Not configured — review AI settings.", "/settings"),
        followUpRulesOk
          ? ready("followup-config", "Follow-up configuration", "Configured — follow-up intervals are set.", "/settings")
          : action("followup-config", "Follow-up configuration", "Not configured — review follow-up settings.", "/settings"),
        prod.cron
          ? ready("scheduled-recovery", "Scheduled recovery", "Configured — the recovery scheduler can run.", "/recovery")
          : action("scheduled-recovery", "Scheduled recovery", "Not configured — set the scheduler secret to enable scheduled runs.", "/recovery"),
      ],
    },
    {
      key: "production",
      title: "Production",
      checks: [
        prod.database
          ? ready("database", "Production database", "Configured — PostgreSQL is active.")
          : info("database", "Production database", "Available — running on the development database; configure PostgreSQL for production."),
        prod.redis
          ? ready("redis", "Redis", "Configured — distributed rate limiting is available.")
          : info("redis", "Redis", "Available — running on in-memory rate limiting; configure Redis for multi-instance production."),
        prod.appUrl
          ? ready("app-url", "App URL", "Configured — public app URL is set.")
          : action("app-url", "App URL", "Not configured — set the public app URL for production."),
        prod.email
          ? ready("prod-email", "Email sending", "Configured.")
          : action("prod-email", "Email sending", "Not configured."),
        whatsappReady
          ? ready("prod-whatsapp", "WhatsApp sending", "Configured.")
          : info("prod-whatsapp", "WhatsApp sending", "Available — WhatsApp is not connected; website chat works without it."),
        prod.cron
          ? ready("prod-cron", "Scheduler authentication", "Configured.")
          : action("prod-cron", "Scheduler authentication", "Not configured."),
      ],
    },
  ];

  const readyCount = sections.flatMap((s) => s.checks).filter((c) => c.status === "ready").length;
  const actionCount = sections.flatMap((s) => s.checks).filter((c) => c.status === "action").length;

  return {
    calculatedAt,
    organizationId,
    organizationName: org?.name ?? null,
    sections,
    readyCount,
    actionCount,
  };
}
