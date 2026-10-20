import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

// Synthetic 1536-dim vectors: DATABASE round-trip only. This says nothing
// about the OpenAI embedding provider (needs OPENAI_API_KEY + network;
// see BLOCKED notes). Dimension matches vector(1536) exactly.
const synthVec = (seed: number) =>
  Array.from({ length: 1536 }, (_, i) => (((i + 1) * 2654435761 + seed * 97) % 1000) / 1000);
vi.mock("@/lib/knowledge/embeddings", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/knowledge/embeddings")>();
  return {
    ...mod,
    generateEmbeddings: async (texts: string[]) => ({
      embeddings: texts.map((_, i) => synthVec(i + 1)),
      usage: { inputTokens: texts.length * 10, totalTokens: texts.length * 10 },
    }),
    generateEmbedding: async () => ({ embedding: synthVec(7), usage: { inputTokens: 10, totalTokens: 10 } }),
  };
});

const sessionState: { current: any } = { current: null };
vi.mock("@/lib/auth", () => ({
  getCurrentSession: () => sessionState.current,
}));

vi.mock("@/db/client", () => ({
  db: (globalThis as any).__PG_RT_DB__,
  closeDatabase: async () => undefined,
  sqlite: undefined,
}));

function req(url: string, init?: { method?: string; body?: unknown }) {
  const { NextRequest } = require("next/server") as typeof import("next/server");
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  } as any);
}

function asStaff(id: string, organizationId: string, role = "BUSINESS_ADMIN") {
  sessionState.current = { user: { id, role, organizationId } };
}
function asBuyer(id: string) {
  sessionState.current = { user: { id, role: "BUYER", organizationId: null } };
}

/**
 * How many migrations the REAL drizzle journal declares. Derived instead of
 * hard-coded so adding a migration (e.g. 0009_two_factor) updates the count
 * once here, while still asserting the migrator applied EXACTLY the journal
 * — no more, no fewer.
 */
function expectedPgMigrationCount(): number {
  const journal = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "drizzle", "pg", "meta", "_journal.json"), "utf8")
  );
  return journal.entries.length;
}

/**
 * PostgreSQL runtime suite (PGlite: real PostgreSQL 17.4 + pgvector 0.8.0,
 * in-process and dependency-free).
 *
 * What this proves on a REAL Postgres engine: journal-driven migration of
 * every drizzle/pg file (incl. corrected 0004 + pgvector + HNSW), TEXT
 * id/FK conventions, jsonb/vector/integer/text columns, defaults, the
 * timestamp-resume upgrade path, idempotent re-runs, and the REAL
 * application data layer (leads, properties, knowledge, buyer, tenant
 * isolation) executing PG SQL end to end.
 *
 * Explicitly NOT proven here: postgres.js pooling/TCP behavior, managed-
 * service extension privileges, pg_dump/restore, production performance,
 * and the OpenAI embedding provider (mocked synthetic vectors).
 */
describe("postgresql runtime (isolated PGlite)", () => {
  let pg: any;
  let db: any;
  let schema: typeof import("@/db/schema");
  let ids: Record<string, string>;
  let api: Record<string, any>;
  let lib: Record<string, any>;

  beforeAll(async () => {
    process.env.DATABASE_URL = "postgres://pg-test.invalid/basera_pg_runtime_test";
    pg = new PGlite({ extensions: { vector } });
    db = drizzlePglite(pg, { schema: (await import("@/db/schema-pg")) as any });
    (globalThis as any).__PG_RT_DB__ = db;

    // 1. Fresh install via the REAL migrator over the REAL journal.
    await migratePglite(db, { migrationsFolder: "./drizzle/pg" });

    schema = await import("@/db/schema");
    lib = {
      leads: await import("@/lib/data/leads"),
      properties: await import("@/lib/data/properties"),
      conversations: await import("@/lib/data/conversations"),
      buyer: await import("@/lib/data/buyer"),
      knowledge: await import("@/lib/knowledge/indexing"),
      retrieval: await import("@/lib/knowledge/retrieval"),
      risk: await import("@/lib/revenue-at-risk"),
      recovery: await import("@/lib/recovery-engine"),
      nba: await import("@/lib/next-best-action"),
      intel: await import("@/lib/revenue-intelligence"),
      emailVerify: await import("@/lib/email-verification"),
    };
    api = {
      leads: await import("@/app/api/leads/route"),
      leadById: await import("@/app/api/leads/[id]/route"),
      comparisons: await import("@/app/api/buyer/comparisons/route"),
      comparisonById: await import("@/app/api/buyer/comparisons/[id]/route"),
      docs: await import("@/app/api/knowledge/documents/route"),
      visits: await import("@/app/api/buyer/visits/route"),
    };

    const now = new Date().toISOString();
    const [orgA] = await db.insert(schema.organizations).values({ name: "Org A", slug: "pg-org-a", isDemo: false }).returning();
    const [orgB] = await db.insert(schema.organizations).values({ name: "Org B", slug: "pg-org-b", isDemo: false }).returning();
    const [demoOrg] = await db.insert(schema.organizations).values({ name: "Marketplace", slug: "basera", isDemo: true }).returning();
    const mkUser = async (organizationId: string | null, name: string, email: string, role: string) =>
      (await db.insert(schema.users).values({ organizationId, name, email, passwordHash: "hash", role: role as any, emailVerifiedAt: now }).returning())[0];
    const staffA = await mkUser(orgA.id, "Staff A", "pga@x.test", "BUSINESS_ADMIN");
    const agentA = await mkUser(orgA.id, "Agent A", "pgagent@x.test", "SALES_AGENT");
    const staffB = await mkUser(orgB.id, "Staff B", "pgb@x.test", "BUSINESS_ADMIN");
    const buyerA = await mkUser(null, "Buyer A", "pgbuyera@x.test", "BUYER");
    const buyerB = await mkUser(null, "Buyer B", "pgbuyerb@x.test", "BUYER");
    const [prop] = await db
      .insert(schema.properties)
      .values({ organizationId: demoOrg.id, projectName: "PG Heights", propertyType: "APARTMENT", city: "Jaipur", locality: "Tonk Road", priceMinInr: 5000000, priceMaxInr: 7000000, availability: "AVAILABLE" })
      .returning();
    const [prop2] = await db
      .insert(schema.properties)
      .values({ organizationId: demoOrg.id, projectName: "PG Towers", propertyType: "APARTMENT", city: "Jaipur", locality: "Malviya Nagar", priceMinInr: 6000000, priceMaxInr: 8000000, availability: "AVAILABLE" })
      .returning();
    ids = { orgA: orgA.id, orgB: orgB.id, demoOrg: demoOrg.id, staffA: staffA.id, agentA: agentA.id, staffB: staffB.id, buyerA: buyerA.id, buyerB: buyerB.id, prop: prop.id, prop2: prop2.id };
  }, 120000);

  afterAll(async () => {
    try {
      await pg?.close();
    } catch {
      // PGlite WASM teardown noise on some Node versions; data is in-memory.
    }
  });

  it("fresh install creates the full schema with markers", async () => {
    const tables: any = await pg.query(
      "SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
    );
    expect(Number(tables.rows[0].c)).toBeGreaterThanOrEqual(22);
    const markers: any = await pg.query("SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations");
    expect(Number(markers.rows[0].c)).toBe(expectedPgMigrationCount());
    const ext: any = await pg.query("SELECT extversion FROM pg_extension WHERE extname='vector'");
    expect(ext.rows[0]?.extversion).toBeTruthy();
  });

  it("re-running migrations is a safe no-op", async () => {
    await migratePglite(db, { migrationsFolder: "./drizzle/pg" });
    const markers: any = await pg.query("SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations");
    expect(Number(markers.rows[0].c)).toBe(expectedPgMigrationCount());
  });

  it("upgrade resumes from an earliest-state database", async () => {
    // Simulate a database stuck at 0000: apply 0000's real statements, record
    // its real journal marker, then let the REAL migrator resume.
    const pg2: any = new (await import("@electric-sql/pglite")).PGlite({ extensions: { vector } });
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), "drizzle", "pg", "0000_odd_magik.sql"), "utf8");
      for (const stmt of raw.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) {
        await pg2.query(stmt);
      }
      const journal = JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle", "pg", "meta", "_journal.json"), "utf8"));
      const first = journal.entries[0];
      const crypto = await import("node:crypto");
      const fileText = fs.readFileSync(path.join(process.cwd(), "drizzle", "pg", `${first.tag}.sql`), "utf8");
      const hash = crypto.createHash("sha256").update(fileText).digest("hex");
      await pg2.query("CREATE SCHEMA IF NOT EXISTS drizzle");
      await pg2.query("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)");
      await pg2.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)", [hash, first.when]);
      const db2 = drizzlePglite(pg2, { schema: (await import("@/db/schema-pg")) as any });
      await migratePglite(db2, { migrationsFolder: "./drizzle/pg" });
      const markers: any = await pg2.query("SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations");
      expect(Number(markers.rows[0].c)).toBe(expectedPgMigrationCount());
      const chunks: any = await pg2.query("SELECT count(*)::int AS c FROM information_schema.tables WHERE table_name='knowledge_chunks'");
      expect(Number(chunks.rows[0].c)).toBe(1);
    } finally {
      try { await pg2.close(); } catch { /* wasm teardown noise */ }
    }
  }, 120000);

  it("tenant isolation holds on PostgreSQL (data layer + API)", async () => {
    const leadA = await lib.leads.createLead(ids.orgA, { name: "Lead A", source: "MANUAL" });
    const leadB = await lib.leads.createLead(ids.orgB, { name: "Lead B", source: "MANUAL" });
    expect(await lib.leads.getLeadById(ids.orgB, leadA.id)).toBeNull();
    expect((await lib.leads.getLeadById(ids.orgA, leadA.id))?.id).toBe(leadA.id);
    expect(/^\d{4}-\d{2}-\d{2}T/.test(leadA.createdAt)).toBe(true);

    asStaff(ids.staffA, ids.orgA);
    const list = await (await api.leads.GET(req("/api/leads"))).json();
    expect(list.leads.map((l: any) => l.id)).toContain(leadA.id);
    expect(list.leads.map((l: any) => l.id)).not.toContain(leadB.id);
    expect((await api.leadById.GET(req("/x"), { params: { id: leadB.id } })).status).toBe(404);

    asStaff(ids.agentA, ids.orgA, "SALES_AGENT");
    const agentList = await (await api.leads.GET(req("/api/leads"))).json();
    expect(agentList.leads.every((l: any) => l.organizationId === ids.orgA)).toBe(true);
  });

  it("buyer ownership holds on PostgreSQL, ghosts rejected", async () => {
    asBuyer(ids.buyerA);
    expect((await api.comparisons.POST(req("/api/buyer/comparisons", { method: "POST", body: { propertyIds: [ids.prop, "ghost"] } }))).status).toBe(404);
    const created = await (await api.comparisons.POST(req("/api/buyer/comparisons", { method: "POST", body: { propertyIds: [ids.prop, ids.prop2] } }))).json();
    const comparisonId = created.comparison.id as string;
    expect(created.comparison).toBeTruthy();
    asBuyer(ids.buyerB);
    expect((await api.comparisonById.GET(req("/x"), { params: { id: comparisonId } })).status).toBe(404);
    asBuyer(ids.buyerA);
    const fetched = await (await api.comparisonById.GET(req("/x"), { params: { id: comparisonId } })).json();
    expect(fetched.properties).toHaveLength(2);
    expect((await api.comparisonById.DELETE(req("/x", { method: "DELETE" }), { params: Promise.resolve({ id: comparisonId }) })).status).toBe(200);
  });

  it("knowledge documents, chunks (kch_ ids + vectors), and retrieval work", async () => {
    asStaff(ids.staffA, ids.orgA);
    const created = await (
      await api.docs.POST(req("/api/knowledge/documents", { method: "POST", body: { organizationId: ids.orgA, type: "FAQ", title: "PG FAQ", content: "Down payments are typically ten percent.", tags: ["finance", "pg"] } }))
    ).json();
    const docId = created.document.id as string;
    expect(docId.startsWith("kdoc_")).toBe(true);

    const indexed = await lib.knowledge.indexDocument(docId, Buffer.from("Down payments are typically ten percent of the price. Book early for best floors.", "utf8"), "faq.txt", "text/plain");
    expect(indexed.chunksIndexed).toBeGreaterThan(0);

    const chunks: any = await pg.query("SELECT id, embedding FROM knowledge_chunks WHERE document_id=$1", [docId]);
    expect(chunks.rows.length).toBe(indexed.chunksIndexed);
    expect(chunks.rows.every((r: any) => String(r.id).startsWith("kch_"))).toBe(true);
    const first = chunks.rows[0].embedding;
    const vec: number[] = Array.isArray(first) ? first : JSON.parse(first);
    expect(vec.length).toBe(1536);

    // Raw pgvector distance operator works on the stored vectors.
    const literal = `[${vec.slice(0, 1536).join(",")}]`;
    const near: any = await pg.query(`SELECT id, embedding <=> $1::vector AS d FROM knowledge_chunks WHERE document_id=$2 ORDER BY d LIMIT 1`, [literal, docId]);
    expect(near.rows[0]?.id).toBe(chunks.rows[0].id);
    expect(Number(near.rows[0]?.d)).toBeCloseTo(0, 5);

    const results = await lib.retrieval.retrieveKnowledge("down payment", { organizationId: ids.orgA }, { topK: 5, minScore: 0 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].metadata.tags).toContain("finance");

    // FK enforcement: bogus document rejected; cascade delete cleans chunks.
    await expect(pg.query(`INSERT INTO knowledge_chunks (id, document_id, organization_id, chunk_index, content, embedding) VALUES ('kch_orphan', 'nope', '${ids.orgA}', 0, 'x', '[1]')`)).rejects.toThrow();
    await pg.query("DELETE FROM knowledge_documents WHERE id=$1", [docId]);
    const left: any = await pg.query("SELECT count(*)::int AS c FROM knowledge_chunks WHERE document_id=$1", [docId]);
    expect(Number(left.rows[0].c)).toBe(0);
  }, 120000);

  it("dates, numerics, and aggregates keep their application shapes", async () => {
    const prop = await lib.properties.createProperty(ids.orgA, { projectName: "PG Towers", propertyType: "APARTMENT", bhk: 2, city: "Noida", locality: "Sector 150", priceMinInr: 6500000, priceMaxInr: 7500000 } as any);
    expect(prop.priceMaxInr).toBe(7500000);
    const matches = await (await import("@/lib/ai/property-matching")).matchProperties(ids.orgA, { city: "Noida", bhk: 2, budgetMaxInr: 8000000 });
    expect(matches.length).toBeGreaterThan(0);
    const risk = await lib.risk.getOrganizationRevenueRisk(ids.orgA);
    expect(typeof risk.totalRevenueAtRisk).toBe("number");
    const intel = await lib.intel.getRevenueIntelligence(ids.orgA);
    expect(typeof intel.overview.totalRevenueAtRisk).toBe("number");
    const nba = await lib.nba.getOrganizationNextBestActions(ids.orgA);
    expect(Array.isArray(nba.actions)).toBe(true);
  });

  it("buyer visits + email verification work on PostgreSQL", async () => {
    asBuyer(ids.buyerA);
    const future = new Date(Date.now() + 86400000).toISOString();
    const created = await (await api.visits.POST(req("/api/buyer/visits", { method: "POST", body: { propertyId: ids.prop, scheduledAt: future } }))).json();
    expect(created.visit?.id).toBeTruthy();
    const { rawToken } = await lib.emailVerify.createEmailVerification(ids.buyerA);
    const consumed = await lib.emailVerify.consumeEmailVerification(rawToken);
    expect(consumed?.userId).toBe(ids.buyerA);
    await lib.emailVerify.markEmailVerified(ids.buyerA);
  });
});
