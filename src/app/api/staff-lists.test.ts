import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";

vi.mock("server-only", () => ({}));

const sessionState: { current: any } = { current: null };
vi.mock("@/lib/auth", () => ({
  getCurrentSession: () => sessionState.current,
}));

function req(url: string, init?: { method?: string }) {
  return new NextRequest(`http://localhost${url}`, { method: init?.method ?? "GET" } as any);
}

function asStaff(id: string, organizationId: string, role = "BUSINESS_ADMIN") {
  sessionState.current = { user: { id, role, organizationId } };
}
function asBuyer(id: string) {
  sessionState.current = { user: { id, role: "BUYER", organizationId: null } };
}
function asAnonymous() {
  sessionState.current = null;
}

/**
 * Staff list/detail hardening (Priority 2B): authentication, tenant scope,
 * bounded pagination, malformed inputs, and per-user rate limits.
 * Isolated temp DB with owned-cleanup teardown.
 */
describe("staff lists + details (isolated db)", () => {
  let ids: Record<string, string>;
  let api: Record<string, any>;
  let testDb: IsolatedTestDb;

  beforeAll(async () => {
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;

    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const { createLead } = await import("@/lib/data/leads");
    const [orgA] = await db.insert(schema.organizations).values({ name: "Org A", slug: "staff-a" }).returning();
    const [orgB] = await db.insert(schema.organizations).values({ name: "Org B", slug: "staff-b" }).returning();
    const mkUser = async (organizationId: string, name: string, email: string, role: string) =>
      (await db.insert(schema.users).values({ organizationId, name, email, passwordHash: "hash", role: role as any }).returning())[0];
    const staffA = await mkUser(orgA.id, "Staff A", "sa@staff.test", "BUSINESS_ADMIN");
    const agentA = await mkUser(orgA.id, "Agent A", "aa@staff.test", "SALES_AGENT");
    const agentOther = await mkUser(orgA.id, "Agent Other", "ao@staff.test", "SALES_AGENT");
    const staffB = await mkUser(orgB.id, "Staff B", "sb@staff.test", "BUSINESS_ADMIN");
    const [buyer] = await db.insert(schema.users).values({ name: "Buyer", email: "b@staff.test", passwordHash: "hash", role: "BUYER" }).returning();
    const leadIds: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const lead = await createLead(orgA.id, { name: `Lead ${i}`, source: "MANUAL" } as any);
      leadIds.push(lead.id);
    }
    const [foreignLead] = await db.insert(schema.leads).values({ organizationId: orgB.id, name: "Foreign", source: "MANUAL", score: 0 } as any).returning();
    ids = {
      orgA: orgA.id, orgB: orgB.id, staffA: staffA.id, agentA: agentA.id,
      agentOther: agentOther.id, staffB: staffB.id, buyer: buyer.id,
      leadA: leadIds[0], foreignLead: (foreignLead as any).id,
    };

    api = {
      leads: await import("@/app/api/leads/route"),
      leadById: await import("@/app/api/leads/[id]/route"),
      properties: await import("@/app/api/properties/route"),
      appointments: await import("@/app/api/appointments/route"),
      conversations: await import("@/app/api/conversations/route"),
    };
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  it("unauthenticated callers get 401 on every list", async () => {
    asAnonymous();
    const lists = { leads: api.leads, properties: api.properties, appointments: api.appointments, conversations: api.conversations };
    for (const [name, mod] of Object.entries(lists)) {
      expect(await (await (mod as any).GET(req(`/api/${name}`))).status, name).toBe(401);
    }
  });

  it("buyers (no organization) get 403 on staff lists", async () => {
    asBuyer(ids.buyer);
    expect((await api.leads.GET(req("/api/leads"))).status).toBe(403);
    expect((await api.properties.GET(req("/api/properties"))).status).toBe(403);
  });

  it("lists are tenant-scoped and bounded with pagination metadata", async () => {
    asStaff(ids.staffA, ids.orgA);
    const body = await (await api.leads.GET(req("/api/leads"))).json();
    expect(body.leads).toHaveLength(5);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.hasMore).toBe(false);

    const p1 = await (await api.leads.GET(req("/api/leads?limit=2"))).json();
    expect(p1.leads).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    const p2 = await (await api.leads.GET(req("/api/leads?limit=2&offset=4"))).json();
    expect(p2.leads).toHaveLength(1);
    expect(p2.hasMore).toBe(false);

    const clamped = await (await api.leads.GET(req("/api/leads?limit=99999"))).json();
    expect(clamped.limit).toBe(200);
    const fallback = await (await api.leads.GET(req("/api/leads?limit=abc&offset=-3"))).json();
    expect(fallback.limit).toBe(50);
    expect(fallback.leads).toHaveLength(5);
  });

  it("cross-tenant records stay invisible (empty list, 404 detail)", async () => {
    asStaff(ids.staffB, ids.orgB);
    const body = await (await api.leads.GET(req("/api/leads"))).json();
    expect(body.leads.map((l: any) => l.id)).toEqual([ids.foreignLead]);
    expect((await api.leadById.GET(req("/x"), { params: { id: ids.leadA } })).status).toBe(404);
  });

  it("agents keep assigned scope on lists", async () => {
    asStaff(ids.agentA, ids.orgA, "SALES_AGENT");
    const body = await (await api.leads.GET(req("/api/leads"))).json();
    expect(body.leads.every((l: any) => l.organizationId === ids.orgA)).toBe(true);
  });

  it("malformed query values fail safe without 500", async () => {
    asStaff(ids.staffA, ids.orgA);
    expect((await api.properties.GET(req("/api/properties?bhk=notanumber"))).status).toBe(200);
    expect((await api.conversations.GET(req("/api/conversations?status=%%"))).status).toBe(200);
    expect((await api.appointments.GET(req("/api/appointments"))).status).toBe(200);
  });

  it("detail endpoints enforce auth + scope", async () => {
    asAnonymous();
    expect((await api.leadById.GET(req("/x"), { params: { id: ids.leadA } })).status).toBe(401);
    asStaff(ids.staffA, ids.orgA);
    expect((await api.leadById.GET(req("/x"), { params: { id: ids.leadA } })).status).toBe(200);
    expect((await api.leadById.GET(req("/x"), { params: { id: "nope" } })).status).toBe(404);
  });

  it("per-user rate limit returns standard 429 past the budget", async () => {
    // Unique identity per run: the in-memory bucket is process-wide.
    const rlUser = `rl-user-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    asStaff(rlUser, ids.orgA);
    let lastStatus = 200;
    let sawRetryAfter = false;
    for (let i = 0; i < 130; i += 1) {
      const res = await api.leads.GET(req("/api/leads?limit=1"));
      lastStatus = res.status;
      if (res.status === 429) {
        const body = await res.json();
        expect(body.error).toMatch(/too many requests/i);
        if (res.headers.get("Retry-After")) sawRetryAfter = true;
        break;
      }
    }
    expect(lastStatus).toBe(429);
    expect(sawRetryAfter).toBe(true);
  });

  it("normal use far below the budget is unaffected", async () => {
    const normalUser = `normal-user-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    asStaff(normalUser, ids.orgA);
    for (let i = 0; i < 5; i += 1) {
      expect((await api.leads.GET(req("/api/leads?limit=1"))).status).toBe(200);
      expect((await api.properties.GET(req("/api/properties?limit=1"))).status).toBe(200);
    }
  });
});
