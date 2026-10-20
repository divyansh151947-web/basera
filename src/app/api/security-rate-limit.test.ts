import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { setupIsolatedTestDb, teardownIsolatedTestDb, type IsolatedTestDb } from "@/test-utils/test-db";

vi.mock("server-only", () => ({}));

const sessionState: { current: any } = { current: null };
vi.mock("@/lib/auth", () => ({
  getCurrentSession: () => sessionState.current,
}));

function jsonReq(url: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  } as any);
}

function asStaff(id: string, organizationId: string, role = "BUSINESS_ADMIN") {
  sessionState.current = { user: { id, role, organizationId } };
}

/**
 * Route-level regression tests for audit fixes:
 * - Knowledge upload rejects malformed tags with 400 (not 500)
 * - Staff write routes enforce the shared staffApiLimiter (429 when exhausted)
 * - Voice greet/end enforce voice IP limiters
 */
describe("security audit route fixes (isolated db)", () => {
  let testDb: IsolatedTestDb;
  let ids: Record<string, string> = {};
  let api: Record<string, any> = {};

  beforeAll(async () => {
    testDb = setupIsolatedTestDb();
    process.env.DATABASE_URL = testDb.dbUrl;
    const { db } = await import("@/db/client");
    const schema = await import("@/db/schema");
    const [org] = await db.insert(schema.organizations).values({ name: "Route Org", slug: "route-org" }).returning();
    const [staff] = await db
      .insert(schema.users)
      .values({ organizationId: org.id, name: "Staff", email: "staff@route.test", passwordHash: "h", role: "BUSINESS_ADMIN" as any })
      .returning();
    ids = { org: org.id, staff: staff.id };
    api = {
      leads: await import("@/app/api/leads/route"),
      upload: await import("@/app/api/knowledge/documents/upload/route"),
      greet: await import("@/app/api/voice/session/[id]/greet/route"),
      end: await import("@/app/api/voice/session/[id]/end/route"),
      voiceSession: await import("@/app/api/voice/session/route"),
    };
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase().catch(() => undefined);
    if (testDb) teardownIsolatedTestDb(testDb);
  });

  it("knowledge upload rejects malformed tags with 400", async () => {
    asStaff(ids.staff, ids.org);
    const form = new FormData();
    form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    form.set("organizationId", ids.org);
    form.set("type", "FAQ");
    form.set("title", "Bad tags");
    form.set("tags", "{not-json");
    const req = new NextRequest("http://localhost/api/knowledge/documents/upload", { method: "POST", body: form });
    const res = await api.upload.POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(String(body.error).toLowerCase()).toContain("tags");
  });

  it("staff leads POST is rate-limited (429 when budget exhausted)", async () => {
    asStaff(ids.staff, ids.org);
    const { staffApiLimiter, getClientIp } = await import("@/lib/rate-limit");
    // Exhaust this caller's budget directly through the shared limiter.
    const key = `staff-api:${ids.staff}:unknown`;
    for (let i = 0; i < 120; i += 1) {
      await staffApiLimiter.check(key);
    }
    const res = await api.leads.POST(
      jsonReq("/api/leads", { method: "POST", body: { name: "Spam", source: "MANUAL" } })
    );
    expect(res.status).toBe(429);
  });

  it("voice greet/end are rate-limited per IP", async () => {
    const { voiceIpMinuteLimiter } = await import("@/lib/rate-limit");
    // Prove the limiter itself denies after its minute budget (30/min).
    const ipKey = `voice:ip-minute:9.9.9.9-test`;
    let denied = false;
    for (let i = 0; i < 35; i += 1) {
      const r = await voiceIpMinuteLimiter.check(ipKey);
      if (!r.allowed) {
        denied = true;
        break;
      }
    }
    expect(denied).toBe(true);

    // And the routes are wired to those limiters (source-level guard so a
    // future removal fails this test even if budgets change).
    const greetSrc = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/voice/session/[id]/greet/route.ts", "utf8")
    );
    const endSrc = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/voice/session/[id]/end/route.ts", "utf8")
    );
    expect(greetSrc).toMatch(/voiceIpMinuteLimiter/);
    expect(endSrc).toMatch(/voiceIpMinuteLimiter/);
  });
});
