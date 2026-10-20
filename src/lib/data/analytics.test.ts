import { inArray } from "drizzle-orm";
import { describe, expect, it, vi, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { assertTenantScope } from "@/lib/tenant";
import { getTenantAnalyticsSnapshot } from "@/lib/data/analytics";

const RUN = String(Date.now());
const ORG_A = `org-a-${RUN}`;
const ORG_B = `org-b-${RUN}`;

afterAll(async () => {
  await db.delete(schema.appointments).where(inArray(schema.appointments.organizationId, [ORG_A, ORG_B]));
  await db.delete(schema.leads).where(inArray(schema.leads.organizationId, [ORG_A, ORG_B]));
  await db.delete(schema.users).where(inArray(schema.users.organizationId, [ORG_A, ORG_B]));
  await db.delete(schema.properties).where(inArray(schema.properties.organizationId, [ORG_A, ORG_B]));
  await db.delete(schema.organizations).where(inArray(schema.organizations.id, [ORG_A, ORG_B]));
});

async function seedTenant(db: any, orgId: string, workspaceName: string, leadCount: number, convertedCount: number) {
  const [agent] = await db.insert(schema.users).values({
    id: `${orgId}-agent`,
    organizationId: orgId,
    name: `${workspaceName} Agent`,
    email: `${workspaceName.toLowerCase().replace(/\s+/g, "-")}-agent@example.com`,
    passwordHash: "hash",
    role: "SALES_AGENT",
  }).returning();

  const [propertyRow] = await db.insert(schema.properties).values({
    id: `${orgId}-property`,
    organizationId: orgId,
    projectName: `${workspaceName} Residences`,
    developer: "Test Developer",
    propertyType: "APARTMENT",
    city: "Gurgaon",
    locality: "Sector 21",
    priceMinInr: 8000000,
    priceMaxInr: 12000000,
    availability: "AVAILABLE",
    bhk: 3,
    isArchived: false,
  } as any).returning();

  const leads = Array.from({ length: leadCount }, (_, index) => ({
    id: `${orgId}-lead-${index + 1}`,
    organizationId: orgId,
    name: `${workspaceName} Lead ${index + 1}`,
    phone: `+91-90000-${String(index + 1).padStart(5, "0")}`,
    source: "WEBSITE_CHAT",
    status: index < convertedCount ? "CONVERTED" : index === leadCount - 1 ? "QUALIFIED" : "NEW",
    temperature: index < convertedCount ? "HOT" : "COLD",
    preferredCity: "Gurgaon",
    propertyType: "APARTMENT",
    bhk: 3,
    budgetMinInr: 7500000,
    budgetMaxInr: 15000000,
    score: 80,
    assignedAgentId: agent.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  await db.insert(schema.leads).values(leads as any);

  if (leadCount > 0) {
    await db.insert(schema.appointments).values({
      id: `${orgId}-visit`,
      organizationId: orgId,
      leadId: leads[0].id,
      propertyId: propertyRow.id,
      agentId: agent.id,
      type: "SITE_VISIT",
      scheduledAt: new Date().toISOString(),
      status: "SCHEDULED",
      notes: "Site visit scheduled",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);
  }
}

describe("tenant-scoped analytics", () => {
  it("keeps Workspace A and Workspace B analytics completely isolated", async () => {
    const [orgA] = await db.insert(schema.organizations).values({
      id: ORG_A,
      name: "Workspace A",
      slug: `workspace-a-${RUN}`,
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any).returning();

    const [orgB] = await db.insert(schema.organizations).values({
      id: ORG_B,
      name: "Workspace B",
      slug: `workspace-b-${RUN}`,
      isDemo: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any).returning();

    await seedTenant(db, orgA.id, "Workspace A", 10, 2);
    await seedTenant(db, orgB.id, "Workspace B", 20, 10);

    const snapshotA = await getTenantAnalyticsSnapshot(orgA.id, db);
    const snapshotB = await getTenantAnalyticsSnapshot(orgB.id, db);

    expect(snapshotA.totalLeads).toBe(10);
    expect(snapshotA.convertedLeads).toBe(2);
    expect(snapshotB.totalLeads).toBe(20);
    expect(snapshotB.convertedLeads).toBe(10);
    expect(snapshotA.totalLeads).not.toBe(snapshotB.totalLeads);
    expect(snapshotA.convertedLeads).not.toBe(snapshotB.convertedLeads);

    expect(() => assertTenantScope(orgB.id, orgA.id)).toThrow("Organization mismatch for this account");
  });
});
