import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { eq, inArray as sqliteIn } from "drizzle-orm";
import postgres from "postgres";
import path from "path";
import * as sqliteSchema from "../db/schema-sqlite";
import * as pgSchema from "../db/schema-pg";
import { isPostgresDatabaseUrl } from "../db/dialect";

/**
 * One-way SQLite -> PostgreSQL data import (additive and idempotent).
 *
 * - Reads every business table from a SQLite file (SQLITE_SOURCE_PATH or
 *   ./dev.db) and inserts into the PostgreSQL DATABASE_URL.
 * - Preserves original IDs, relationships, timestamps, and nulls, so tenant
 *   data stays referentially intact.
 * - ON CONFLICT DO NOTHING per row: re-running never duplicates rows.
 * - Never deletes anything from either database.
 * - Demo-data handling is explicit: by default, demo organizations AND all
 *   rows that belong to them (leads, conversations, messages, interests,
 *   tokens, …) are skipped. Pass --include-demo to copy everything.
 * - Target PostgreSQL must already be migrated (see src/scripts/migrate.ts).
 */

const TABLES_IN_FK_ORDER = [
  "plans",
  "organizations",
  "users",
  "subscriptions",
  "properties",
  "propertyUnits",
  "leads",
  "leadPropertyInterests",
  "leadScoreEvents",
  "conversations",
  "messages",
  "followUps",
  "appointments",
  "notes",
  "tasks",
  "notifications",
  "integrations",
  "aiConfigs",
  "scoringConfigs",
  "knowledgeDocuments",
  "usageRecords",
  "auditLogs",
  "passwordResetTokens",
] as const;

async function main() {
  const target = process.env.DATABASE_URL;
  if (!isPostgresDatabaseUrl(target)) {
    throw new Error("DATABASE_URL must be a postgres:// URL (target). Refusing to run.");
  }
  const sourcePath = process.env.SQLITE_SOURCE_PATH || path.join(process.cwd(), "dev.db");
  const includeDemo = process.argv.includes("--include-demo");

  const sqlite = new Database(sourcePath, { readonly: true });
  const src = drizzleSqlite(sqlite, { schema: sqliteSchema });
  const sql = postgres(target as string, { max: 5 });
  const dst = drizzlePg(sql, { schema: pgSchema });

  console.log(`Importing ${sourcePath} -> PostgreSQL (${includeDemo ? "including" : "excluding"} demo data)…`);

  // Build the demo exclusion closure: demo orgs plus every row that hangs
  // off them (leads, properties, conversations, users), so dependents never
  // hit foreign keys for skipped parents.
  const demoOrgIds = new Set<string>();
  const demoLeadIds = new Set<string>();
  const demoPropertyIds = new Set<string>();
  const demoConvIds = new Set<string>();
  const demoUserIds = new Set<string>();
  if (!includeDemo) {
    const demos = await src.select({ id: sqliteSchema.organizations.id }).from(sqliteSchema.organizations).where(eq(sqliteSchema.organizations.isDemo, true));
    demos.forEach((d) => demoOrgIds.add(d.id));
    if (demoOrgIds.size > 0) {
      const ids: string[] = [];
      demoOrgIds.forEach((id) => ids.push(id));
      for (const l of await src.select({ id: sqliteSchema.leads.id }).from(sqliteSchema.leads).where(sqliteIn(sqliteSchema.leads.organizationId, ids))) demoLeadIds.add(l.id);
      for (const p of await src.select({ id: sqliteSchema.properties.id }).from(sqliteSchema.properties).where(sqliteIn(sqliteSchema.properties.organizationId, ids))) demoPropertyIds.add(p.id);
      for (const u of await src.select({ id: sqliteSchema.users.id }).from(sqliteSchema.users).where(sqliteIn(sqliteSchema.users.organizationId, ids))) demoUserIds.add(u.id);
      const pendingConvLookups: Array<Promise<void>> = [];
      demoLeadIds.forEach((lid) => {
        pendingConvLookups.push(
          src.select({ id: sqliteSchema.conversations.id }).from(sqliteSchema.conversations).where(eq(sqliteSchema.conversations.leadId, lid)).then((rows) => {
            rows.forEach((c) => demoConvIds.add(c.id));
          })
        );
      });
      await Promise.all(pendingConvLookups);
      console.log(`Skipping ${demoOrgIds.size} demo org(s) + ${demoLeadIds.size} demo lead(s) and dependents.`);
    }
  }

  const isDemoRow = (row: Record<string, unknown>): boolean => {
    const orgId = row.organizationId as string | undefined;
    if (orgId && demoOrgIds.has(orgId)) return true;
    const leadId = row.leadId as string | undefined;
    if (leadId && demoLeadIds.has(leadId)) return true;
    const propertyId = row.propertyId as string | undefined;
    if (propertyId && demoPropertyIds.has(propertyId)) return true;
    const conversationId = row.conversationId as string | undefined;
    if (conversationId && demoConvIds.has(conversationId)) return true;
    const userId = row.userId as string | undefined;
    if (userId && demoUserIds.has(userId)) return true;
    return false;
  };

  const report: Array<{ table: string; copied: number; skippedDemo: number; failed: number }> = [];
  for (const name of TABLES_IN_FK_ORDER) {
    const srcTable: any = (sqliteSchema as any)[name];
    const dstTable: any = (pgSchema as any)[name];
    const rows: Record<string, unknown>[] = await src.select().from(srcTable);
    let copied = 0;
    let skippedDemo = 0;
    let failed = 0;
    for (const row of rows) {
      if (isDemoRow(row)) {
        skippedDemo += 1;
        continue;
      }
      try {
        await dst.insert(dstTable).values(row as any).onConflictDoNothing();
        copied += 1;
      } catch (error) {
        failed += 1;
        console.error(`[${name}] failed row ${JSON.stringify(row).slice(0, 160)}:`, error instanceof Error ? error.message : error);
      }
    }
    report.push({ table: name, copied, skippedDemo, failed });
  }

  for (const r of report) {
    console.log(`${r.table}: copied=${r.copied} skippedDemo=${r.skippedDemo} failed=${r.failed}`);
  }
  const failures = report.reduce((s, r) => s + r.failed, 0);
  sqlite.close();
  await sql.end();
  if (failures > 0) {
    console.error(`Import finished WITH ${failures} failure(s) — see lines above.`);
    process.exit(1);
  }
  console.log("Import complete with no failures.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
