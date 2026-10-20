import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import {
  aiConfigs,
  integrations,
  leads,
  organizations,
  properties,
  users,
} from "@/db/schema";
import { getPilotReadiness, getProductionStatus } from "./pilot-readiness";

const ORG = "pilot-ready-org";
const EMPTY_ORG = "pilot-empty-org";

const SAFE_ENV: Record<string, string | undefined> = {
  DATABASE_URL: "file:./dev.db",
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
  SMTP_HOST: undefined,
  RESEND_API_KEY: undefined,
  APP_URL: "http://localhost:4100",
  NEXTAUTH_URL: undefined,
  CRON_SECRET: undefined,
};

async function wipeOrg(orgId: string) {
  await db.delete(integrations).where(eq(integrations.organizationId, orgId));
  await db.delete(aiConfigs).where(eq(aiConfigs.organizationId, orgId));
  await db.delete(leads).where(eq(leads.organizationId, orgId));
  await db.delete(properties).where(eq(properties.organizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
}

describe("pilot readiness", () => {
  beforeAll(async () => {
    await wipeOrg(ORG);
    await wipeOrg(EMPTY_ORG);
    const now = Date.now();
    await db.insert(organizations).values([
      { id: ORG, name: "Pilot Ready Co", slug: `pilot-ready-${now}`, phone: "+91-90000-00000" },
      { id: EMPTY_ORG, name: "Empty Co", slug: `pilot-empty-${now}` },
    ]);
    const pw = await bcrypt.hash("x", 4);
    await db.insert(users).values({
      id: "pilot-admin", organizationId: ORG, name: "Pilot Admin",
      email: "pilot-admin@example.com", passwordHash: pw, role: "BUSINESS_ADMIN",
    });
    await db.insert(properties).values({
      id: "pilot-prop", organizationId: ORG, projectName: "Sunrise Homes",
      propertyType: "APARTMENT", bhk: 3, city: "Gurgaon", locality: "Sector 62",
      priceMinInr: 11_000_000, priceMaxInr: 12_500_000, availability: "AVAILABLE",
    });
    await db.insert(leads).values({
      id: "pilot-lead", organizationId: ORG, name: "Buyer", source: "WEBSITE_CHAT",
      score: 70, temperature: "WARM", status: "QUALIFIED", budgetMaxInr: 12_000_000,
    });
    await db.insert(aiConfigs).values({
      organizationId: ORG, tone: "friendly_professional", primaryLanguage: "auto",
      greeting: "Hello!", followUpRulesJson: JSON.stringify({ intervalsDays: [1, 3, 7], maxAttempts: 3 }),
    });
    await db.insert(integrations).values({
      organizationId: ORG, type: "WHATSAPP", isEnabled: true, status: "CONFIGURED",
      configJson: JSON.stringify({ phoneNumberId: "12345" }),
    });
  });

  afterAll(async () => {
    await wipeOrg(ORG);
    await wipeOrg(EMPTY_ORG);
  });

  it("1/3. configured workspace reports ready statuses", async () => {
    const r = await getPilotReadiness(ORG, SAFE_ENV);
    expect(r.organizationName).toBe("Pilot Ready Co");
    const byKey = new Map(r.sections.flatMap((s) => s.checks).map((c) => [c.key, c]));
    expect(byKey.get("workspace")?.status).toBe("ready");
    expect(byKey.get("admin")?.status).toBe("ready");
    expect(byKey.get("properties")?.status).toBe("ready");
    expect(byKey.get("property-info")?.status).toBe("ready");
    expect(byKey.get("leads")?.status).toBe("ready");
    expect(byKey.get("whatsapp")?.status).toBe("ready");
    expect(byKey.get("ai-config")?.status).toBe("ready");
    expect(byKey.get("followup-config")?.status).toBe("ready");
    expect(r.actionCount).toBeGreaterThanOrEqual(0);
  });

  it("2. missing configuration is handled safely with action statuses", async () => {
    const r = await getPilotReadiness(EMPTY_ORG, SAFE_ENV);
    const byKey = new Map(r.sections.flatMap((s) => s.checks).map((c) => [c.key, c]));
    expect(byKey.get("admin")?.status).toBe("action");
    expect(byKey.get("admin")?.statusLabel).toBe("Action required");
    expect(byKey.get("properties")?.status).toBe("action");
    expect(byKey.get("whatsapp")?.status).toBe("action");
    expect(byKey.get("whatsapp")?.statusLabel).toBe("Action required");
    expect(r.actionCount).toBeGreaterThan(0);
  });

  it("5. organization isolation: empty org never sees the configured org", async () => {
    const empty = await getPilotReadiness(EMPTY_ORG, SAFE_ENV);
    const json = JSON.stringify(empty);
    expect(json).not.toMatch(/Pilot Ready Co|Sunrise Homes|pilot-admin@example.com/);
    const full = await getPilotReadiness(ORG, SAFE_ENV);
    expect(JSON.stringify(full)).not.toMatch(/Empty Co/);
  });

  it("4. secrets are never returned (values, keys, tokens, URLs)", async () => {
    const secretEnv: Record<string, string | undefined> = {
      ...SAFE_ENV,
      CRON_SECRET: "cron-super-secret-xyz-123",
      RESEND_API_KEY: "re_secret_key_abc",
      SMTP_HOST: "smtp.example.com",
      SMTP_PASSWORD: "smtp-pass-999",
      UPSTASH_REDIS_REST_URL: "https://secret.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok-secret-456",
      DATABASE_URL: "postgres://admin:dbpass123@db.internal:5432/basera",
    };
    const prod = getProductionStatus(secretEnv);
    expect(prod.cron).toBe(true);
    expect(prod.email).toBe(true);
    expect(prod.redis).toBe(true);
    expect(prod.database).toBe(true);
    const r = await getPilotReadiness(ORG, secretEnv);
    const json = JSON.stringify({ prod, readiness: r });
    for (const secret of [
      "cron-super-secret-xyz-123", "re_secret_key_abc", "smtp-pass-999",
      "tok-secret-456", "dbpass123", "secret.upstash.io",
    ]) {
      expect(json).not.toContain(secret);
    }
    // Only safe status vocabulary is used.
    const labels = r.sections.flatMap((s) => s.checks).map((c) => c.statusLabel);
    for (const label of labels) {
      expect(["Configured", "Not configured", "Action required", "Available"]).toContain(label);
    }
  });
});

describe("production status matrix (env-only, no DB)", () => {
  it("missing everything reports not configured", () => {
    const p = getProductionStatus({});
    expect(p.database).toBe(false);
    expect(p.redis).toBe(false);
    expect(p.email).toBe(false);
    expect(p.appUrl).toBe(false);
    expect(p.cron).toBe(false);
    expect(p.databaseLabel).toBe("Not configured");
  });

  it("sqlite DATABASE_URL is not production postgres", () => {
    expect(getProductionStatus({ DATABASE_URL: "file:./dev.db" }).database).toBe(false);
    expect(getProductionStatus({ DATABASE_URL: "postgres://u@h/db" }).database).toBe(true);
    expect(getProductionStatus({ DATABASE_URL: "postgresql://u@h/db" }).database).toBe(true);
  });

  it("email accepts either SMTP or Resend presence", () => {
    expect(getProductionStatus({ SMTP_HOST: "smtp.gmail.com" }).email).toBe(true);
    expect(getProductionStatus({ RESEND_API_KEY: "re_x" }).email).toBe(true);
  });
});
