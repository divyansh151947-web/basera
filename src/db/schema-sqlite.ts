// ==========================================================================
// DATABASE SCHEMA — AI Real Estate Sales & Lead Management SaaS
// Drizzle ORM + SQLite for dev/demo (zero external infra, no native binary
// downloads required — important in restricted/offline build environments).
// For production, swap ./client.ts to the postgres-js driver and change
// column helpers from sqlite-core to pg-core; table/column names are kept
// portable (no SQLite-only types used beyond integer/text booleans).
//
// MULTI-TENANCY RULE: every business-scoped table has `organizationId`.
// Every query in lib/data/*.ts MUST filter by the caller's organizationId.
// See src/lib/tenant.ts for the enforcement helper used across the app.
// ==========================================================================

import { sqliteTable, text, integer, index, uniqueIndex, blob } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const timestamps = {
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
};

// -----------------------------
// PLATFORM / TENANCY
// -----------------------------

export const plans = sqliteTable("plans", {
  id: id(),
  name: text("name").notNull(),
  tier: text("tier", { enum: ["STARTER", "PROFESSIONAL", "ENTERPRISE"] }).notNull(),
  monthlyPriceInr: integer("monthly_price_inr").notNull(),
  leadLimit: integer("lead_limit").notNull(),
  aiMessageLimit: integer("ai_message_limit").notNull(),
  teamMemberLimit: integer("team_member_limit").notNull(),
  propertyLimit: integer("property_limit").notNull(),
  features: text("features").notNull().default("{}"), // JSON string
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: timestamps.createdAt,
});

export const organizations = sqliteTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  logoUrl: text("logo_url"),
  phone: text("phone"),
  email: text("email"),
  locationsJson: text("locations_json").default("[]"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (t) => ({
  slugIdx: uniqueIndex("org_slug_idx").on(t.slug),
}));

export const subscriptions = sqliteTable("subscriptions", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().references(() => plans.id),
  status: text("status", { enum: ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"] }).notNull().default("TRIALING"),
  trialEndsAt: text("trial_ends_at"),
  currentPeriodEnd: text("current_period_end"),
  providerRef: text("provider_ref"),
  ...timestamps,
}, (t) => ({ orgIdx: uniqueIndex("sub_org_idx").on(t.organizationId) }));

// -----------------------------
// USERS / AUTH / RBAC
// -----------------------------

export const users = sqliteTable("users", {
  id: id(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }), // null = SUPER_ADMIN
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["SUPER_ADMIN", "BUSINESS_ADMIN", "MANAGER", "SALES_AGENT", "BUYER"] }).notNull(),
  phone: text("phone"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  emailVerifiedAt: text("email_verified_at"),
  lastLoginAt: text("last_login_at"),
  ...timestamps,
}, (t) => ({
  emailIdx: uniqueIndex("user_email_idx").on(t.email),
  orgIdx: index("user_org_idx").on(t.organizationId),
}));

// -----------------------------
// PROPERTIES
// -----------------------------

export const properties = sqliteTable("properties", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectName: text("project_name").notNull(),
  developer: text("developer"),
  propertyType: text("property_type", { enum: ["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"] }).notNull(),
  bhk: integer("bhk"),
  city: text("city").notNull(),
  locality: text("locality").notNull(),
  address: text("address"),
  priceMinInr: integer("price_min_inr").notNull(),
  priceMaxInr: integer("price_max_inr").notNull(),
  areaSqft: integer("area_sqft"),
  floor: text("floor"),
  amenitiesJson: text("amenities_json").default("[]"),
  parking: integer("parking", { mode: "boolean" }).notNull().default(false),
  possessionDate: text("possession_date"),
  availability: text("availability", { enum: ["AVAILABLE", "LIMITED", "SOLD_OUT", "UPCOMING"] }).notNull().default("AVAILABLE"),
  furnishing: text("furnishing", { enum: ["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"] }),
  description: text("description"),
  imagesJson: text("images_json").default("[]"),
  videoUrl: text("video_url"),
  videoPosterUrl: text("video_poster_url"),
  brochureUrl: text("brochure_url"),
  documentsJson: text("documents_json").default("[]"),
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (t) => ({
  orgIdx: index("prop_org_idx").on(t.organizationId),
  matchIdx: index("prop_match_idx").on(t.organizationId, t.city, t.bhk, t.propertyType),
}));

export const propertyUnits = sqliteTable("property_units", {
  id: id(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  unitNumber: text("unit_number").notNull(),
  floor: text("floor"),
  areaSqft: integer("area_sqft"),
  priceInr: integer("price_inr"),
  status: text("status").notNull().default("AVAILABLE"),
  createdAt: timestamps.createdAt,
}, (t) => ({ propIdx: index("unit_prop_idx").on(t.propertyId) }));

// -----------------------------
// LEADS / CRM
// -----------------------------

export const leads = sqliteTable("leads", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name"),
  phone: text("phone"),
  email: text("email"),
  source: text("source", { enum: ["WEBSITE_CHAT", "WEBSITE_FORM", "WHATSAPP", "INSTAGRAM", "FACEBOOK", "EMAIL", "API", "MANUAL", "VOICE"] }).notNull(),
  preferredCity: text("preferred_city"),
  preferredLocality: text("preferred_locality"),
  propertyType: text("property_type", { enum: ["APARTMENT", "VILLA", "PLOT", "INDEPENDENT_HOUSE", "COMMERCIAL"] }),
  bhk: integer("bhk"),
  budgetMinInr: integer("budget_min_inr"),
  budgetMaxInr: integer("budget_max_inr"),
  purpose: text("purpose", { enum: ["BUY", "RENT", "INVEST"] }),
  timeline: text("timeline"),
  loanRequired: integer("loan_required", { mode: "boolean" }),
  siteVisitInterest: integer("site_visit_interest", { mode: "boolean" }),
  decisionMaker: integer("decision_maker", { mode: "boolean" }),
  status: text("status", {
    enum: ["NEW", "CONTACTED", "QUALIFIED", "INTERESTED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED", "LOST", "NURTURE"],
  }).notNull().default("NEW"),
  temperature: text("temperature", { enum: ["HOT", "WARM", "COLD"] }).notNull().default("COLD"),
  score: integer("score").notNull().default(0),
  aiSummary: text("ai_summary"),
  assignedAgentId: text("assigned_agent_id").references(() => users.id),
  tagsJson: text("tags_json").default("[]"),
  lastContactAt: text("last_contact_at"),
  nextFollowUpAt: text("next_follow_up_at"),
  optedOut: integer("opted_out", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (t) => ({
  orgIdx: index("lead_org_idx").on(t.organizationId),
  statusIdx: index("lead_status_idx").on(t.organizationId, t.status),
  tempIdx: index("lead_temp_idx").on(t.organizationId, t.temperature),
  phoneIdx: index("lead_phone_idx").on(t.organizationId, t.phone),
}));

export const leadPropertyInterests = sqliteTable("lead_property_interests", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  matchType: text("match_type", { enum: ["EXACT", "CLOSE", "ALTERNATIVE"] }).notNull(),
  matchScore: integer("match_score").notNull(),
  createdAt: timestamps.createdAt,
}, (t) => ({
  leadIdx: index("lpi_lead_idx").on(t.leadId),
  propIdx: index("lpi_prop_idx").on(t.propertyId),
}));

export const leadScoreEvents = sqliteTable("lead_score_events", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  temperature: text("temperature", { enum: ["HOT", "WARM", "COLD"] }).notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamps.createdAt,
}, (t) => ({ leadIdx: index("lse_lead_idx").on(t.leadId) }));

// -----------------------------
// CONVERSATIONS / MESSAGES
// -----------------------------

export const conversations = sqliteTable("conversations", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel", { enum: ["WEBSITE_CHAT", "WHATSAPP", "INSTAGRAM", "FACEBOOK", "EMAIL", "VOICE"] }).notNull(),
  status: text("status", { enum: ["AI_HANDLING", "HUMAN_HANDLING", "CLOSED"] }).notNull().default("AI_HANDLING"),
  handoffReason: text("handoff_reason"),
  ...timestamps,
}, (t) => ({
  orgIdx: index("conv_org_idx").on(t.organizationId),
  leadIdx: index("conv_lead_idx").on(t.leadId),
}));

export const messages = sqliteTable("messages", {
  id: id(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  sender: text("sender", { enum: ["LEAD", "AI", "AGENT", "SYSTEM"] }).notNull(),
  senderUserId: text("sender_user_id").references(() => users.id),
  content: text("content").notNull(),
  language: text("language"),
  metadataJson: text("metadata_json"),
  // Provider message IDs let inbound webhooks be safely retried without
  // creating a second CRM/AI turn. They are intentionally provider-agnostic
  // so future channels can use the same audit trail.
  externalMessageId: text("external_message_id"),
  createdAt: timestamps.createdAt,
}, (t) => ({
  convIdx: index("msg_conv_idx").on(t.conversationId),
  externalMessageIdIdx: uniqueIndex("msg_external_id_idx").on(t.externalMessageId),
}));

// -----------------------------
// FOLLOW-UPS
// -----------------------------

export const followUps = sqliteTable("follow_ups", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  channel: text("channel", { enum: ["WEBSITE_CHAT", "WHATSAPP", "INSTAGRAM", "FACEBOOK", "EMAIL"] }).notNull(),
  messageDraft: text("message_draft"),
  status: text("status", { enum: ["PENDING", "SENT", "SKIPPED", "STOPPED", "FAILED"] }).notNull().default("PENDING"),
  sentAt: text("sent_at"),
  stopReason: text("stop_reason"),
  createdAt: timestamps.createdAt,
}, (t) => ({
  orgStatusIdx: index("fu_org_status_idx").on(t.organizationId, t.status, t.scheduledFor),
  leadIdx: index("fu_lead_idx").on(t.leadId),
}));

// -----------------------------
// APPOINTMENTS
// -----------------------------

export const appointments = sqliteTable("appointments", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  propertyId: text("property_id").references(() => properties.id),
  agentId: text("agent_id").references(() => users.id),
  type: text("type", { enum: ["SITE_VISIT", "CALL", "MEETING"] }).notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  status: text("status", { enum: ["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"] }).notNull().default("SCHEDULED"),
  notes: text("notes"),
  ...timestamps,
}, (t) => ({
  orgIdx: index("appt_org_idx").on(t.organizationId, t.scheduledAt),
  leadIdx: index("appt_lead_idx").on(t.leadId),
}));

// -----------------------------
// NOTES / TASKS
// -----------------------------

export const notes = sqliteTable("notes", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  createdAt: timestamps.createdAt,
}, (t) => ({ leadIdx: index("note_lead_idx").on(t.leadId) }));

export const tasks = sqliteTable("tasks", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id),
  assigneeId: text("assignee_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  dueAt: text("due_at"),
  isDone: integer("is_done", { mode: "boolean" }).notNull().default(false),
  createdAt: timestamps.createdAt,
}, (t) => ({ orgIdx: index("task_org_idx").on(t.organizationId) }));

// -----------------------------
// RECOVERY SCHEDULER CLAIMS (Batch 8 Prompt 2)
// -----------------------------

// Minimal claim/lease table for production-safe scheduled recovery. One row
// per (organization, lead): execution is lead-scoped, so a lead-level lease
// is the correct granularity. The PRIMARY KEY on claim_key makes the initial
// claim atomic (INSERT ... ON CONFLICT DO NOTHING); expiry + owner
// compare-and-set makes reclaims atomic. No other table can do this —
// audit_logs/tasks/follow_ups have no uniqueness to conflict on, and
// stuffing leases into user-visible rows would corrupt CRM data.
export const recoveryClaims = sqliteTable("recovery_claims", {
  claimKey: text("claim_key").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  leakType: text("leak_type"),
  actionType: text("action_type"),
  claimedBy: text("claimed_by").notNull(),
  claimedAt: text("claimed_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  status: text("status", { enum: ["CLAIMED", "COMPLETED", "SKIPPED", "FAILED", "DEFERRED"] }).notNull().default("CLAIMED"),
  resultSummary: text("result_summary"),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({ orgIdx: index("rclaim_org_idx").on(t.organizationId, t.status, t.expiresAt) }));

// -----------------------------
// VOICE SESSIONS (Voice AI Phase 1)
// -----------------------------

// Minimal durable session ledger for browser voice sessions. PROVEN
// NECESSARY (not speculative): module-level in-memory state does not survive
// across Next.js route compilations/requests in this setup (verified live:
// a session stored by POST /api/voice/session was invisible to
// POST /api/voice/session/[id]/turn in the same process). Durable rows fix
// dev, production, and future multi-instance serving alike. Transcript,
// lead fields, scores, and matches live in the standard conversation/message
// rows; this table holds only session bookkeeping (status/turns/timing).
export const voiceSessions = sqliteTable("voice_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  conversationChannel: text("conversation_channel").notNull(),
  language: text("language").notNull().default("en"),
  providerId: text("provider_id").notNull(),
  isMock: integer("is_mock", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["ACTIVE", "ENDED"] }).notNull().default("ACTIVE"),
  turns: integer("turns").notNull().default(0),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({ orgIdx: index("voice_org_idx").on(t.organizationId, t.status) }));

// -----------------------------
// NOTIFICATIONS
// -----------------------------

export const notifications = sqliteTable("notifications", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: timestamps.createdAt,
}, (t) => ({ orgIdx: index("notif_org_idx").on(t.organizationId, t.isRead) }));

// -----------------------------
// INTEGRATIONS
// -----------------------------

export const integrations = sqliteTable("integrations", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["WHATSAPP", "GOOGLE_CALENDAR", "EMAIL", "CRM_WEBHOOK", "INSTAGRAM", "FACEBOOK"] }).notNull(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(false),
  configJson: text("config_json").default("{}"),
  status: text("status").notNull().default("NOT_CONNECTED"),
  lastSyncAt: text("last_sync_at"),
  ...timestamps,
}, (t) => ({ orgIdx: index("integ_org_idx").on(t.organizationId) }));

// -----------------------------
// AI CONFIG / KNOWLEDGE / SCORING
// -----------------------------

export const aiConfigs = sqliteTable("ai_configs", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tone: text("tone").notNull().default("friendly_professional"),
  primaryLanguage: text("primary_language").notNull().default("auto"),
  greeting: text("greeting").notNull().default("Hi! Thanks for your interest. Could you tell me what kind of property you're looking for?"),
  qualificationRulesJson: text("qualification_rules_json").default("{}"),
  handoffRulesJson: text("handoff_rules_json").default("{}"),
  followUpRulesJson: text("follow_up_rules_json").default('{"intervalsDays":[1,3,7],"maxAttempts":3}'),
  updatedAt: timestamps.updatedAt,
}, (t) => ({ orgIdx: uniqueIndex("aicfg_org_idx").on(t.organizationId) }));

export const scoringConfigs = sqliteTable("scoring_configs", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  weightsJson: text("weights_json").notNull(),
  hotThreshold: integer("hot_threshold").notNull().default(80),
  warmThreshold: integer("warm_threshold").notNull().default(50),
  updatedAt: timestamps.updatedAt,
}, (t) => ({ orgIdx: uniqueIndex("score_org_idx").on(t.organizationId) }));

export const knowledgeDocuments = sqliteTable("knowledge_documents", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["FAQ", "POLICY", "DOCUMENT", "WEBSITE_CONTENT"] }).notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  sourceFileName: text("source_file_name"),
  sourceFileType: text("source_file_type"),
  sourceFileSize: integer("source_file_size"),
  projectId: text("project_id").references(() => properties.id, { onDelete: "set null" }),
  propertyId: text("property_id").references(() => properties.id, { onDelete: "set null" }),
  locality: text("locality"),
  city: text("city"),
  language: text("language").default("en"),
  effectiveDate: text("effective_date"),
  version: text("version"),
  tags: text("tags").default("[]"),
  processingStatus: text("processing_status").default("pending"),
  indexingStatus: text("indexing_status").default("pending"),
  chunkCount: integer("chunk_count").default(0),
  errorMessage: text("error_message"),
  ...timestamps,
}, (t) => ({
  orgIdx: index("kdoc_org_idx").on(t.organizationId),
  projectIdx: index("kdoc_project_idx").on(t.projectId),
  propertyIdx: index("kdoc_property_idx").on(t.propertyId),
  localityIdx: index("kdoc_locality_idx").on(t.locality),
  cityIdx: index("kdoc_city_idx").on(t.city),
  statusIdx: index("kdoc_status_idx").on(t.processingStatus, t.indexingStatus),
}));

export const knowledgeChunks = sqliteTable("knowledge_chunks", {
  id: id(),
  documentId: text("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: blob("embedding", { mode: "json" }).notNull(),
  metadata: text("metadata"),
  createdAt: timestamps.createdAt,
}, (t) => ({
  orgIdx: index("kchunk_org_idx").on(t.organizationId),
  docIdx: index("kchunk_doc_idx").on(t.documentId),
  createdIdx: index("kchunk_created_idx").on(t.createdAt),
}));

// -----------------------------
// USAGE / AUDIT
// -----------------------------

export const usageRecords = sqliteTable("usage_records", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  aiMessages: integer("ai_messages").notNull().default(0),
  leadsCreated: integer("leads_created").notNull().default(0),
  followUpsSent: integer("follow_ups_sent").notNull().default(0),
  activeUsers: integer("active_users").notNull().default(0),
  storageMb: integer("storage_mb").notNull().default(0),
  createdAt: timestamps.createdAt,
}, (t) => ({ orgIdx: index("usage_org_idx").on(t.organizationId, t.periodStart) }));

export const auditLogs = sqliteTable("audit_logs", {
  id: id(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadataJson: text("metadata_json"),
  createdAt: timestamps.createdAt,
}, (t) => ({ orgIdx: index("audit_org_idx").on(t.organizationId, t.createdAt) }));

// -----------------------------
// BUYER-SPECIFIC DATA
// -----------------------------

export const buyerSavedProperties = sqliteTable("buyer_saved_properties", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  savedAt: text("saved_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: index("bsp_user_idx").on(t.userId),
  propertyIdx: index("bsp_property_idx").on(t.propertyId),
  uniqueUserProperty: uniqueIndex("bsp_user_property_idx").on(t.userId, t.propertyId),
}));

export const buyerPropertyComparisons = sqliteTable("buyer_property_comparisons", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  propertyIds: text("property_ids").notNull(), // JSON array of property IDs
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: index("bpc_user_idx").on(t.userId),
}));

export const buyerVisitRequests = sqliteTable("buyer_visit_requests", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  scheduledAt: text("scheduled_at").notNull(),
  status: text("status", { enum: ["REQUESTED", "SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"] }).notNull().default("REQUESTED"),
  agentId: text("agent_id").references(() => users.id),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: index("bvr_user_idx").on(t.userId),
  propertyIdx: index("bvr_property_idx").on(t.propertyId),
  statusIdx: index("bvr_status_idx").on(t.status),
  scheduledIdx: index("bvr_scheduled_idx").on(t.scheduledAt),
}));

export const buyerRecentlyViewed = sqliteTable("buyer_recently_viewed", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  viewedAt: text("viewed_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: index("brv_user_idx").on(t.userId),
  propertyIdx: index("brv_property_idx").on(t.propertyId),
  uniqueUserProperty: uniqueIndex("brv_user_property_idx").on(t.userId, t.propertyId),
}));

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: index("prt_user_idx").on(t.userId),
  expiryIdx: index("prt_expiry_idx").on(t.expiresAt),
}));

// -----------------------------
// TWO-FACTOR AUTHENTICATION (TOTP)
// -----------------------------
// Secrets are never stored raw: `secretEnc` holds AES-256-GCM ciphertext
// keyed from NEXTAUTH_SECRET (src/lib/two-factor.ts), so a database leak
// alone cannot be replayed against an authenticator app enrollment.
// `enabledAt` stays NULL until the owner proves possession of the secret by
// submitting a valid TOTP code (enrollment verified before enabling).

export const twoFactorCredentials = sqliteTable("two_factor_credentials", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  secretEnc: text("secret_enc").notNull(),
  enabledAt: text("enabled_at"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: uniqueIndex("tf_cred_user_idx").on(t.userId),
}));

// Single-use, expiring login proofs: created only after the password checks
// out, marked verified by /api/auth/two-factor/verify, and consumed by the
// credentials `authorize` callback when the session is minted.
export const twoFactorChallenges = sqliteTable("two_factor_challenges", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  verifiedAt: text("verified_at"),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: index("tf_chal_user_idx").on(t.userId),
  expiryIdx: index("tf_chal_expiry_idx").on(t.expiresAt),
}));

// Recovery codes: salted SHA-256 hashes only (never plaintext), consumed
// one at a time as a fallback when the authenticator app is unavailable.
export const twoFactorRecoveryCodes = sqliteTable("two_factor_recovery_codes", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: index("tf_rec_user_idx").on(t.userId),
}));

// -----------------------------
// BUYER PREFERENCES
// -----------------------------

export const buyerPreferences = sqliteTable("buyer_preferences", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  budgetMinInr: integer("budget_min_inr"),
  budgetMaxInr: integer("budget_max_inr"),
  preferredCity: text("preferred_city"),
  preferredLocality: text("preferred_locality"),
  propertyType: text("property_type"),
  bhk: integer("bhk"),
  minAreaSqft: integer("min_area_sqft"),
  maxAreaSqft: integer("max_area_sqft"),
  furnishing: text("furnishing"),
  possessionTimeline: text("possession_timeline"),
  purpose: text("purpose", { enum: ["BUY", "RENT", "INVEST"] }),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userIdx: uniqueIndex("bp_user_idx").on(t.userId),
}));

// -----------------------------
// AUTOMATED SALES WORKFLOWS
// -----------------------------

export const workflowDefinitions = sqliteTable("workflow_definitions", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  triggersJson: text("triggers_json").notNull().default("[]"),
  conditionsJson: text("conditions_json").notNull().default("{}"),
  actionsJson: text("actions_json").notNull().default("[]"),
  ...timestamps,
}, (t) => ({
  orgIdx: index("wfdef_org_idx").on(t.organizationId),
  enabledIdx: index("wfdef_org_enabled_idx").on(t.organizationId, t.isEnabled),
  uniqueOrgName: uniqueIndex("wfdef_org_name_idx").on(t.organizationId, t.name),
}));

export const workflowExecutions = sqliteTable("workflow_executions", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workflowDefinitionId: text("workflow_definition_id").notNull().references(() => workflowDefinitions.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
  status: text("status", { enum: ["PENDING", "COMPLETED", "FAILED", "SKIPPED"] }).notNull().default("PENDING"),
  triggeredBy: text("triggered_by").notNull(),
  resultSummary: text("result_summary"),
  ...timestamps,
}, (t) => ({
  orgIdx: index("wfexec_org_idx").on(t.organizationId, t.createdAt),
  defIdx: index("wfexec_def_idx").on(t.workflowDefinitionId),
  leadIdx: index("wfexec_lead_idx").on(t.leadId),
}));
