import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";

vi.mock("server-only", () => ({}));

const sessionState: { current: any } = { current: null };
vi.mock("@/lib/auth", () => ({
  getCurrentSession: () => sessionState.current,
}));

function req(url: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  } as any);
}

function asStaff(id: string, organizationId: string, role = "BUSINESS_ADMIN") {
  sessionState.current = { user: { id, role, organizationId } };
}
function asAnonymous() {
  sessionState.current = null;
}

/**
 * Tenant-isolation + knowledge-API authorization regression tests
 * (Step 2, Phases B/D). Isolated temp database; the real dev.db is untouched.
 */
describe("tenant isolation + knowledge auth (isolated db)", () => {
  let ids: Record<string, string>;
  let api: Record<string, any>;
  let testDb: IsolatedTestDb;

  beforeAll(async () => {
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;

    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const { createLead } = await import("@/lib/data/leads");
    const [orgA] = await db.insert(schema.organizations).values({ name: "Org A", slug: "org-a" }).returning();
    const [orgB] = await db.insert(schema.organizations).values({ name: "Org B", slug: "org-b" }).returning();
    const mkUser = async (organizationId: string, name: string, email: string, role: string) =>
      (
        await db
          .insert(schema.users)
          .values({ organizationId, name, email, passwordHash: "hash", role: role as any })
          .returning()
      )[0];
    const staffA = await mkUser(orgA.id, "Staff A", "a@org.test", "MANAGER");
    const agentA = await mkUser(orgA.id, "Agent A", "agent@org.test", "SALES_AGENT");
    const leadA = await createLead(orgA.id, { name: "Lead A", source: "MANUAL" } as any);
    const leadB = await createLead(orgB.id, { name: "Lead B", source: "MANUAL" } as any);
    const [docB] = await db
      .insert(schema.knowledgeDocuments)
      .values({ organizationId: orgB.id, type: "FAQ", title: "Secret B", content: "classified" })
      .returning();
    ids = { orgA: orgA.id, orgB: orgB.id, staffA: staffA.id, agentA: agentA.id, leadA: leadA.id, leadB: leadB.id, docB: docB.id };

    api = {
      leads: await import("@/app/api/leads/route"),
      leadById: await import("@/app/api/leads/[id]/route"),
      appointments: await import("@/app/api/appointments/route"),
      stats: await import("@/app/api/knowledge/stats/route"),
      docs: await import("@/app/api/knowledge/documents/route"),
      docById: await import("@/app/api/knowledge/documents/[id]/route"),
      retrieve: await import("@/app/api/knowledge/retrieve/route"),
      upload: await import("@/app/api/knowledge/documents/upload/route"),
    };
  });

  afterAll(async () => {
    // Release the better-sqlite3 handle first: Windows cannot remove an
    // open database file, so close before deleting the owned directory.
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  it("unauthenticated callers cannot reach staff or knowledge APIs", async () => {
    asAnonymous();
    expect((await api.leads.GET(req("/api/leads"))).status).toBe(401);
    expect((await api.leadById.GET(req("/x"), { params: { id: ids.leadA } })).status).toBe(401);
    expect((await api.stats.GET(req(`/api/knowledge/stats?organizationId=${ids.orgA}`))).status).toBe(401);
    expect((await api.docs.GET(req(`/api/knowledge/documents?organizationId=${ids.orgA}`))).status).toBe(401);
    expect(
      (
        await api.retrieve.POST(
          req("/api/knowledge/retrieve", { method: "POST", body: { query: "x", organizationId: ids.orgA } })
        )
      ).status
    ).toBe(401);
  });

  it("staff cannot read or mutate another organization's CRM records", async () => {
    asStaff(ids.staffA, ids.orgA);
    const list = await (await api.leads.GET(req("/api/leads"))).json();
    expect(list.leads.map((l: any) => l.id)).toEqual([ids.leadA]);
    expect((await api.leadById.GET(req("/x"), { params: { id: ids.leadB } })).status).toBe(404);
    expect(
      (await api.leadById.PATCH(req("/x", { method: "PATCH", body: { name: "Hijacked" } }), { params: { id: ids.leadB } })).status
    ).toBe(404);
    expect(
      (
        await api.appointments.POST(
          req("/api/appointments", {
            method: "POST",
            body: { leadId: ids.leadB, type: "SITE_VISIT", scheduledAt: new Date(Date.now() + 86400000).toISOString() },
          })
        )
      ).status
    ).toBe(404);
  });

  it("smuggled organizationIds in bodies cannot escape the session tenant", async () => {
    asStaff(ids.staffA, ids.orgA);
    const created = await (
      await api.leads.POST(
        req("/api/leads", { method: "POST", body: { name: "Smuggle", source: "MANUAL", organizationId: ids.orgB } })
      )
    ).json();
    expect(created.lead.organizationId).toBe(ids.orgA);
  });

  it("agents keep the existing assigned-scope visibility", async () => {
    asStaff(ids.agentA, ids.orgA, "SALES_AGENT");
    const list = await (await api.leads.GET(req("/api/leads"))).json();
    const visible = list.leads.map((l: any) => l.id);
    expect(visible).toContain(ids.leadA);
    expect(visible).not.toContain(ids.leadB);
    expect(list.leads.every((l: any) => l.organizationId === ids.orgA)).toBe(true);
  });

  it("knowledge APIs reject cross-organization access", async () => {
    asStaff(ids.staffA, ids.orgA);
    expect((await api.stats.GET(req(`/api/knowledge/stats?organizationId=${ids.orgB}`))).status).toBe(403);
    expect((await api.docs.GET(req(`/api/knowledge/documents?organizationId=${ids.orgB}`))).status).toBe(403);
    expect(
      (
        await api.docs.POST(
          req("/api/knowledge/documents", {
            method: "POST",
            body: { organizationId: ids.orgB, type: "FAQ", title: "Injected", content: "x" },
          })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await api.retrieve.POST(
          req("/api/knowledge/retrieve", { method: "POST", body: { query: "secret", organizationId: ids.orgB } })
        )
      ).status
    ).toBe(403);
    expect((await api.docById.GET(req("/x"), { params: { id: ids.docB } })).status).toBe(404);
    expect(
      (await api.docById.PATCH(req("/x", { method: "PATCH", body: { title: "Rewritten" } }), { params: { id: ids.docB } })).status
    ).toBe(404);
    expect((await api.docById.DELETE(req(`/x?organizationId=${ids.orgB}`), { params: { id: ids.docB } })).status).toBe(403);

    const form = new FormData();
    form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    form.set("organizationId", ids.orgB);
    form.set("type", "FAQ");
    form.set("title", "Upload attack");
    const uploadReq = new NextRequest("http://localhost/api/knowledge/documents/upload", { method: "POST", body: form });
    expect((await api.upload.POST(uploadReq)).status).toBe(403);
  });

  it("knowledge APIs still serve the caller's own organization", async () => {
    asStaff(ids.staffA, ids.orgA);
    expect((await api.stats.GET(req(`/api/knowledge/stats?organizationId=${ids.orgA}`))).status).toBe(200);
    expect((await api.docs.GET(req(`/api/knowledge/documents?organizationId=${ids.orgA}`))).status).toBe(200);
  });
});
