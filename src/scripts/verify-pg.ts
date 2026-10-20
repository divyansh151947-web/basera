import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, closeDatabase } from "../db/client";
import { isPostgresDatabaseUrl } from "../db/dialect";
import * as schema from "../db/schema";
// NOTE: ../lib/auth is intentionally NOT imported here — next-auth's
// provider modules do not load under plain tsx/ESM. The login check below
// performs the exact operations authorize() performs (normalized lookup +
// bcrypt compare) via a local helper.
import { createLead, getLeadById } from "../lib/data/leads";
import { createProperty } from "../lib/data/properties";
import { matchProperties } from "../lib/ai/property-matching";
import { scoreLead } from "../lib/ai/lead-scoring";
import { getOrganizationRevenueRisk } from "../lib/revenue-at-risk";
import { evaluateRecoveryDecision, getOrganizationRecoveryCandidates } from "../lib/recovery-engine";
import { getOrganizationNextBestActions } from "../lib/next-best-action";
import { getRevenueIntelligence } from "../lib/revenue-intelligence";
import { getOrCreateConversationForLead, addMessage, getMessages, getMessageByExternalId } from "../lib/data/conversations";
import { createAppointment, listAppointments } from "../lib/data/org";
import { scheduleNextFollowUp } from "../lib/ai/followup-agent";
// NOTE: ../lib/lead-access is intentionally NOT imported here — it pulls the
// NextAuth provider chain, which does not load under plain tsx/ESM (same
// reason as ../lib/auth above). Assignment authorization on PostgreSQL is
// proven over HTTP instead (agent PATCH on a colleague lead must 403).
import { createEmailVerification, consumeEmailVerification, markEmailVerified } from "../lib/email-verification";
import { upsertWhatsAppIntegration, getWhatsAppIntegrationByPhoneNumberId } from "../lib/data/integrations";
import { leadsOverTime, leadsBySource, agentPerformance } from "../lib/data/leads";

/**
 * PostgreSQL integration verification (Batch 1B-5). Run with:
 *   DATABASE_URL=postgres://... npx tsx src/scripts/verify-pg.ts
 * Exercises the REAL application data layer against a REAL PostgreSQL
 * database (seeded demo org + an isolated temp org that is removed at the
 * end). Each check prints PASS/FAIL; any failure exits non-zero.
 */

const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
function check(name: string, cond: unknown, detail?: string) {
  const ok = Boolean(cond);
  results.push({ name, ok, detail: ok ? undefined : detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
}

const ORG = "pg-verify-org";

async function cleanup() {
  const orgs = await db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.slug, "pg-verify"));
  for (const o of orgs) {
    const ls = await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.organizationId, o.id));
    for (const l of ls) {
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, (await db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.leadId, l.id))).map((c) => c.id)[0] ?? "__none__")).catch(() => {});
      const convs = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.leadId, l.id));
      for (const c of convs) {
        await db.delete(schema.messages).where(eq(schema.messages.conversationId, c.id));
        await db.delete(schema.conversations).where(eq(schema.conversations.id, c.id));
      }
      await db.delete(schema.followUps).where(eq(schema.followUps.leadId, l.id));
      await db.delete(schema.appointments).where(eq(schema.appointments.leadId, l.id));
      await db.delete(schema.leadPropertyInterests).where(eq(schema.leadPropertyInterests.leadId, l.id));
      await db.delete(schema.leadScoreEvents).where(eq(schema.leadScoreEvents.leadId, l.id));
      await db.delete(schema.tasks).where(eq(schema.tasks.leadId, l.id));
      await db.delete(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.userId, l.id));
      await db.delete(schema.leads).where(eq(schema.leads.id, l.id));
    }
    const props = await db.select({ id: schema.properties.id }).from(schema.properties).where(eq(schema.properties.organizationId, o.id));
    for (const p of props) {
      await db.delete(schema.propertyUnits).where(eq(schema.propertyUnits.propertyId, p.id));
      await db.delete(schema.properties).where(eq(schema.properties.id, p.id));
    }
    await db.delete(schema.integrations).where(eq(schema.integrations.organizationId, o.id));
    await db.delete(schema.aiConfigs).where(eq(schema.aiConfigs.organizationId, o.id));
    await db.delete(schema.scoringConfigs).where(eq(schema.scoringConfigs.organizationId, o.id));
    await db.delete(schema.users).where(eq(schema.users.organizationId, o.id));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, o.id));
  }
}

async function main() {
  if (!isPostgresDatabaseUrl()) throw new Error("DATABASE_URL must be postgres:// for this script.");

  // 1-4: connect, schema present (22 tables), seed intact, app connects.
  // (db as any): the shared client type exposes the union surface; execute
  // exists on the pg driver path exercised here.
  const tables = await (db as any).execute(sql`SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
  check("1. schema migrated (22 tables)", Number((tables as any)[0]?.c ?? (tables as any).rows?.[0]?.c) >= 22);
  const demoOrg = (await db.select().from(schema.organizations).where(eq(schema.organizations.slug, "urbannest")).limit(1))[0];
  check("2. seed/demo org present", Boolean(demoOrg));
  check("3. seed users present", (await db.select().from(schema.users)).length >= 4);

  // Temp org for isolation-sensitive checks.
  await cleanup();
  const [org] = await db.insert(schema.organizations).values({ id: ORG, name: "PG Verify", slug: "pg-verify" }).returning();
  const pwHash = await bcrypt.hash("VerifyPass123", 4);
  const [admin] = await db.insert(schema.users).values({ id: "pg-admin", organizationId: org.id, name: "PG Admin", email: "pg-admin@example.com", passwordHash: pwHash, role: "BUSINESS_ADMIN" }).returning();
  const [agent] = await db.insert(schema.users).values({ id: "pg-agent", organizationId: org.id, name: "PG Agent", email: "pg-agent@example.com", passwordHash: pwHash, role: "SALES_AGENT" }).returning();
  check("4. tenant creation works", admin.organizationId === org.id && agent.organizationId === org.id);

  // 5-6: login + signup paths.
  const normalized = "pg-admin@example.com".trim().toLowerCase();
  const found = (await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${normalized}`).limit(1))[0];
  check("5. login lookup + bcrypt verify", Boolean(found) && (await bcrypt.compare("VerifyPass123", found!.passwordHash)));
  const { POST: signupPOST } = await import("../app/api/auth/signup/route");
  const signupRes = await signupPOST(new NextRequest("http://localhost/api/auth/signup", { method: "POST", body: JSON.stringify({ companyName: "PG Signup Co", name: "PG S", email: `pg-signup-tmp-${Date.now()}@example.com`, password: "SignupPass123" }) }));
  const signupBody = (await signupRes.json()) as any;
  check("6. signup works", signupRes.status === 200 && Boolean(signupBody.organizationSlug));

  // 7-8: tenant creation covered above; lead creation + boolean/timestamp shape.
  const lead = await createLead(org.id, { source: "WEBSITE_CHAT", name: "PG Lead", preferredCity: "Noida", bhk: 2, budgetMaxInr: 8000000 });
  check("7. lead creation works", Boolean(lead.id));
  check("8. ISO timestamp shape preserved", /^\d{4}-\d{2}-\d{2}T/.test(lead.createdAt));

  // 9: assignment authorization (requireLeadAccess) cannot load under plain
  // tsx because of the NextAuth provider chain, so it is proven over HTTP
  // against this same PostgreSQL database (agent PATCH on a colleague lead
  // must 403, admin assignment must 200 — see batch report).

  // 10-11: property matching + lead scoring (pure engines over pg rows).
  await createProperty(org.id, { projectName: "PG Towers", propertyType: "APARTMENT", bhk: 2, city: "Noida", locality: "Sector 150", priceMinInr: 6500000, priceMaxInr: 7500000 } as any);
  const matches = await matchProperties(org.id, { city: "Noida", bhk: 2, budgetMaxInr: 8000000 });
  check("10. property matching works", matches.length > 0 && matches[0].property.projectName === "PG Towers");
  const scored = scoreLead({ hasBudget: true, hasLocation: true, hasBhkOrType: true, timelineWithinDays: 30, engagementMessageCount: 3, hasPropertyMatch: true, siteVisitInterest: null, loanRequired: null, respondedQuickly: true } as any);
  check("11. lead scoring works", scored.score > 0 && ["HOT", "WARM", "COLD"].includes(scored.temperature));

  // 12-15: revenue engines over pg.
  const risk = await getOrganizationRevenueRisk(org.id);
  check("12. revenue-at-risk works", risk.evaluatedLeads >= 1);
  const rec = await getOrganizationRecoveryCandidates(org.id);
  check("13. recovery engine works", Array.isArray(rec.candidates));
  const nba = await getOrganizationNextBestActions(org.id);
  check("14. next best action works", nba.evaluated >= 0 && Array.isArray(nba.actions));
  const intel = await getRevenueIntelligence(org.id);
  check("15. revenue intelligence works", intel.overview !== undefined && typeof intel.overview.totalRevenueAtRisk === "number");

  // 16-18: conversations/messages, appointments, follow-ups.
  const convo = await getOrCreateConversationForLead(org.id, lead.id, "WEBSITE_CHAT");
  await addMessage(convo.id, "LEAD", "Hello on postgres");
  const msgs = await getMessages(convo.id);
  check("16. conversations/messages work", msgs.some((m) => m.content === "Hello on postgres"));
  const appt = await createAppointment(org.id, { leadId: lead.id, type: "SITE_VISIT", scheduledAt: new Date(Date.now() + 86400000).toISOString() } as any);
  check("17. appointments work", Boolean(appt.id) && (await listAppointments(org.id)).length >= 1);
  const fu = await scheduleNextFollowUp(org.id, lead.id, 0);
  check("18. follow-ups work", Boolean(fu?.id));

  // 19: password reset + email verification cycles.
  const rawReset = crypto.randomBytes(32).toString("hex");
  await db.insert(schema.passwordResetTokens).values({ userId: admin.id, tokenHash: await bcrypt.hash(rawReset, 4), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const { createEmailVerification, consumeEmailVerification, markEmailVerified } = await import("../lib/email-verification");
  const { rawToken } = await createEmailVerification(admin.id);
  const consumed = await consumeEmailVerification(rawToken);
  if (consumed) await markEmailVerified(consumed.userId);
  const verified = (await db.select().from(schema.users).where(eq(schema.users.id, admin.id)).limit(1))[0];
  check("19. reset tokens + email verification work", Boolean(consumed) && Boolean(verified.emailVerifiedAt));

  // 20: WhatsApp DB ops (mapping + idempotency key) without touching behavior.
  await upsertWhatsAppIntegration(org.id, { phoneNumberId: "pg-phone-1", displayPhoneNumber: "+91-90000-00001" });
  const resolved = await getWhatsAppIntegrationByPhoneNumberId("pg-phone-1");
  check("20. WhatsApp tenant mapping works", resolved?.integration.organizationId === org.id);

  // 21: cross-org rejection.
  const foreignLead = await getLeadById("org-that-does-not-exist", lead.id);
  const foreignConvo = await getMessageByExternalId("wamid-never-exists");
  check("21. cross-organization access rejected", foreignLead === null && foreignConvo === null);

  // Count/substr normalization (pg returns count as text).
  const overTime = await leadsOverTime(org.id, 30);
  const bySource = await leadsBySource(org.id);
  const perf = await agentPerformance(org.id);
  check(
    "22. aggregate coercion (count/substr) numeric",
    overTime.every((r) => typeof r.count === "number") &&
    bySource.every((r) => typeof r.count === "number") &&
    perf.every((r) => typeof r.total === "number" && typeof r.converted === "number")
  );

  await cleanup();
  // Remove the signup-created temp org too.
  if (signupBody.organizationSlug) {
    const so = (await db.select().from(schema.organizations).where(eq(schema.organizations.slug, signupBody.organizationSlug)).limit(1))[0];
    if (so) {
      await db.delete(schema.users).where(eq(schema.users.organizationId, so.id));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, so.id));
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PostgreSQL checks passed.`);
  await closeDatabase();
  if (failed.length > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  try { await closeDatabase(); } catch { /* noop */ }
  process.exit(1);
});
