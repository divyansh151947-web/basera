import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { integrations } from "@/db/schema";

export interface WhatsAppIntegrationConfig {
  phoneNumberId: string;
  displayPhoneNumber?: string;
  businessAccountId?: string;
}

function parseConfig(raw: string | null): WhatsAppIntegrationConfig | null {
  try {
    const value = JSON.parse(raw || "{}") as Partial<WhatsAppIntegrationConfig>;
    return typeof value.phoneNumberId === "string" && value.phoneNumberId ? value as WhatsAppIntegrationConfig : null;
  } catch {
    return null;
  }
}

export async function getWhatsAppIntegration(organizationId: string) {
  const rows = await db.select().from(integrations).where(and(eq(integrations.organizationId, organizationId), eq(integrations.type, "WHATSAPP"))).limit(1);
  const integration = rows[0] ?? null;
  return integration ? { integration, config: parseConfig(integration.configJson) } : null;
}

/** Resolve the tenant exclusively from a registered Meta phone-number ID. */
export async function getWhatsAppIntegrationByPhoneNumberId(phoneNumberId: string) {
  const rows = await db.select().from(integrations).where(and(eq(integrations.type, "WHATSAPP"), eq(integrations.isEnabled, true)));
  const matches: Array<{ integration: typeof integrations.$inferSelect; config: WhatsAppIntegrationConfig }> = [];
  for (const integration of rows) {
    const config = parseConfig(integration.configJson);
    if (config?.phoneNumberId === phoneNumberId) matches.push({ integration, config });
  }
  // A duplicate configuration is a tenant-safety problem. Refuse to route
  // rather than arbitrarily selecting an agency's inventory.
  return matches.length === 1 ? matches[0] : null;
}

export async function upsertWhatsAppIntegration(organizationId: string, config: WhatsAppIntegrationConfig) {
  const enabled = await db.select().from(integrations).where(and(eq(integrations.type, "WHATSAPP"), eq(integrations.isEnabled, true)));
  for (const integration of enabled) {
    const existingConfig = parseConfig(integration.configJson);
    if (integration.organizationId !== organizationId && existingConfig?.phoneNumberId === config.phoneNumberId) {
      throw new Error("This WhatsApp phone number ID is already assigned to another organization");
    }
  }
  const existing = await getWhatsAppIntegration(organizationId);
  const value = { phoneNumberId: config.phoneNumberId, displayPhoneNumber: config.displayPhoneNumber, businessAccountId: config.businessAccountId };
  if (existing) {
    const [row] = await db.update(integrations).set({ configJson: JSON.stringify(value), isEnabled: true, status: "CONFIGURED", updatedAt: new Date().toISOString() }).where(eq(integrations.id, existing.integration.id)).returning();
    return row;
  }
  const [row] = await db.insert(integrations).values({ organizationId, type: "WHATSAPP", isEnabled: true, status: "CONFIGURED", configJson: JSON.stringify(value) }).returning();
  return row;
}
