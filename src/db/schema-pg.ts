// ==========================================================================
// DATABASE SCHEMA — PostgreSQL port of the Basera data model.
// Mirrors src/db/schema-sqlite.ts table-for-table, column-for-column,
// index-for-index (same table/column/index names, same relationships, same
// tenant boundaries). Only STORAGE types are mapped:
//
// - text -> text (incl. enums, which stay app-validated text, and JSON
//   columns, which stay text so read/write behavior is identical)
// - integer -> integer (money stays integer rupees — never float)
// - integer booleans -> boolean (native; app code already uses true/false)
// - createdAt/updatedAt (DB-defaulted) -> text with a UTC ISO-8601 default
//   (to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) so every timestamp in
//   every database has the identical string shape the app already parses
//   and lexicographically compares. All other timestamp-ish columns are
//   app-written ISO strings and stay plain text.
// ==========================================================================

import { pgTable, text, integer, boolean, index, uniqueIndex, jsonb, vector } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
// UTC ISO-8601 default matching the app's Date.toISOString() shape.
const utcNowIso = sql`to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const timestamps = {
  createdAt: text("created_at").notNull().default(utcNowIso),
  updatedAt: text("updated_at").notNull().default(utcNowIso),
};

// -----------------------------
// PLATFORM / TENANCY
// -----------------------------

export const plans = pgTable("plans", {
  id: id(),
  name: text("name").notNull(),
  tier: text("tier").notNull(),
  monthlyPriceInr: integer("monthly_price_inr").notNull(),
  leadLimit: integer("lead_limit").notNull(),
  aiMessageLimit: integer("ai_message_limit").notNull(),
  teamMemberLimit: integer("team_member_limit").notNull(),
  propertyLimit: integer("property_limit").notNull(),
  features: text("features").notNull().default("{}"), // JSON string
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamps.createdAt,
});

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  logoUrl: text("logo_url"),
  phone: text("phone"),
  email: text("email"),
  locationsJson: text("locations_json").default("[]"),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => ({
  slugIdx: uniqueIndex("org_slug_idx").on(t.slug),
}));

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().references(() => plans.id),
  status: text("status").notNull().default("TRIALING"),
  trialEndsAt: text("trial_ends_at"),
  currentPeriodEnd: text("current_period_end"),
  providerRef: text("provider_ref"),
  ...timestamps,
}, (t) => ({ orgIdx: uniqueIndex("sub_org_idx").on(t.organizationId) }));

// -----------------------------
// USERS / AUTH / RBAC
// -----------------------------

export const users = pgTable("users", {
  id: id(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }), // null = SUPER_ADMIN
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["BUYER", "SUPER_ADMIN", "BUSINESS_ADMIN", "MANAGER", "SALES_AGENT"] }).notNull(),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
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

export const properties = pgTable("properties", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectName: text("project_name").notNull(),
  developer: text("developer"),
  propertyType: text("property_type").notNull(),
  bhk: integer("bhk"),
  city: text("city").notNull(),
  locality: text("locality").notNull(),
  address: text("address"),
  priceMinInr: integer("price_min_inr").notNull(),
  priceMaxInr: integer("price_max_inr").notNull(),
  areaSqft: integer("area_sqft"),
  floor: text("floor"),
  amenitiesJson: text("amenities_json").default("[]"),
  parking: boolean("parking").notNull().default(false),
  possessionDate: text("possession_date"),
  availability: text("availability").notNull().default("AVAILABLE"),
  furnishing: text("furnishing"),
  description: text("description"),
  imagesJson: text("images_json").default("[]"),
  videoUrl: text("video_url"),
  videoPosterUrl: text("video_poster_url"),
  brochureUrl: text("brochure_url"),
  documentsJson: text("documents_json").default("[]"),
  isArchived: boolean("is_archived").notNull().default(false),
  ...timestamps,
}, (t) => ({
  orgIdx: index("prop_org_idx").on(t.organizationId),
  matchIdx: index("prop_match_idx").on(t.organizationId, t.city, t.bhk, t.propertyType),
}));

export const propertyUnits = pgTable("property_units", {
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

export const leads = pgTable("leads", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name"),
  phone: text("phone"),
  email: text("email"),
  source: text("source").notNull(),
  preferredCity: text("preferred_city"),
  preferredLocality: text("preferred_locality"),
  propertyType: text("property_type"),
  bhk: integer("bhk"),
  budgetMinInr: integer("budget_min_inr"),
  budgetMaxInr: integer("budget_max_inr"),
  purpose: text("purpose"),
  timeline: text("timeline"),
  loanRequired: boolean("loan_required"),
  siteVisitInterest: boolean("site_visit_interest"),
  decisionMaker: boolean("decision_maker"),
  status: text("status").notNull().default("NEW"),
  temperature: text("temperature").notNull().default("COLD"),
  score: integer("score").notNull().default(0),
  aiSummary: text("ai_summary"),
  assignedAgentId: text("assigned_agent_id").references(() => users.id),
  tagsJson: text("tags_json").default("[]"),
  lastContactAt: text("last_contact_at"),
  nextFollowUpAt: text("next_follow_up_at"),
  optedOut: boolean("opted_out").notNull().default(false),
  ...timestamps,
}, (t) => ({
  orgIdx: index("lead_org_idx").on(t.organizationId),
  statusIdx: index("lead_status_idx").on(t.organizationId, t.status),
  tempIdx: index("lead_temp_idx").on(t.organizationId, t.temperature),
  phoneIdx: index("lead_phone_idx").on(t.organizationId, t.phone),
}));

export const leadPropertyInterests = pgTable("lead_property_interests", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  matchType: text("match_type").notNull(),
  matchScore: integer("match_score").notNull(),
  createdAt: timestamps.createdAt,
}, (t) => ({
  leadIdx: index("lpi_lead_idx").on(t.leadId),
  propIdx: index("lpi_prop_idx").on(t.propertyId),
}));

export const leadScoreEvents = pgTable("lead_score_events", {
  id: id(),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  temperature: text("temperature").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamps.createdAt,
}, (t) => ({ leadIdx: index("lse_lead_idx").on(t.leadId) }));

// -----------------------------
// CONVERSATIONS / MESSAGES
// -----------------------------

export const conversations = pgTable("conversations", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("AI_HANDLING"),
  handoffReason: text("handoff_reason"),
  ...timestamps,
}, (t) => ({
  orgIdx: index("conv_org_idx").on(t.organizationId),
  leadIdx: index("conv_lead_idx").on(t.leadId),
}));

export const messages = pgTable("messages", {
  id: id(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  sender: text("sender").notNull(),
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

export const followUps = pgTable("follow_ups", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  channel: text("channel").notNull(),
  messageDraft: text("message_draft"),
  status: text("status").notNull().default("PENDING"),
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

export const appointments = pgTable("appointments", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  propertyId: text("property_id").references(() => properties.id),
  agentId: text("agent_id").references(() => users.id),
  type: text("type").notNull(),
  scheduledAt: text("scheduled_at").notNull(),
  status: text("status").notNull().default("SCHEDULED"),
  notes: text("notes"),
  ...timestamps,
}, (t) => ({
  orgIdx: index("appt_org_idx").on(t.organizationId, t.scheduledAt),
  leadIdx: index("appt_lead_idx").on(t.leadId),
}));

// -----------------------------
// NOTES / TASKS
// -----------------------------

export const notes = pgTable("notes", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  authorId: text("author_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  createdAt: timestamps.createdAt,
}, (t) => ({ leadIdx: index("note_lead_idx").on(t.leadId) }));

export const tasks = pgTable("tasks", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id),
  assigneeId: text("assignee_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  dueAt: text("due_at"),
  isDone: boolean("is_done").notNull().default(false),
  createdAt: timestamps.createdAt,
}, (t) => ({ orgIdx: index("task_org_idx").on(t.organizationId) }));

// -----------------------------
// RECOVERY SCHEDULER CLAIMS (Batch 8 Prompt 2)
// -----------------------------

// PostgreSQL mirror of the claim/lease table (same table/column/index
// names, relationships, and tenant boundaries as the SQLite port; timestamps
// stay app-written ISO text so comparisons behave identically).
export const recoveryClaims = pgTable("recovery_claims", {
  claimKey: text("claim_key").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  leakType: text("leak_type"),
  actionType: text("action_type"),
  claimedBy: text("claimed_by").notNull(),
  claimedAt: text("claimed_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  status: text("status").notNull().default("CLAIMED"),
  resultSummary: text("result_summary"),
  updatedAt: text("updated_at").notNull().default(utcNowIso),
}, (t) => ({ orgIdx: index("rclaim_org_idx").on(t.organizationId, t.status, t.expiresAt) }));

// -----------------------------
// VOICE SESSIONS (Voice AI Phase 1)
// -----------------------------

// PostgreSQL mirror of the voice session ledger (same names/relations;
// timestamps stay app-written ISO text like the claim table).
export const voiceSessions = pgTable("voice_sessions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  conversationChannel: text("conversation_channel").notNull(),
  language: text("language").notNull().default("en"),
  providerId: text("provider_id").notNull(),
  isMock: boolean("is_mock").notNull().default(true),
  status: text("status").notNull().default("ACTIVE"),
  turns: integer("turns").notNull().default(0),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  updatedAt: text("updated_at").notNull().default(utcNowIso),
}, (t) => ({ orgIdx: index("voice_org_idx").on(t.organizationId, t.status) }));

// -----------------------------
// NOTIFICATIONS
// -----------------------------

export const notifications = pgTable("notifications", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamps.createdAt,
}, (t) => ({ orgIdx: index("notif_org_idx").on(t.organizationId, t.isRead) }));

// -----------------------------
// INTEGRATIONS
// -----------------------------

export const integrations = pgTable("integrations", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  configJson: text("config_json").default("{}"),
  status: text("status").notNull().default("NOT_CONNECTED"),
  lastSyncAt: text("last_sync_at"),
  ...timestamps,
}, (t) => ({ orgIdx: index("integ_org_idx").on(t.organizationId) }));

// -----------------------------
// AI CONFIG / KNOWLEDGE / SCORING
// -----------------------------

export const aiConfigs = pgTable("ai_configs", {
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

export const scoringConfigs = pgTable("scoring_configs", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  weightsJson: text("weights_json").notNull(),
  hotThreshold: integer("hot_threshold").notNull().default(80),
  warmThreshold: integer("warm_threshold").notNull().default(50),
  updatedAt: timestamps.updatedAt,
}, (t) => ({ orgIdx: uniqueIndex("score_org_idx").on(t.organizationId) }));

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: id(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
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
  tags: jsonb("tags").default(sql`'[]'::jsonb`),
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

export const knowledgeChunks = pgTable("knowledge_chunks", {
  // TEXT ids like every other table: the app writes `kch_<uuid>` strings,
  // and document/organization reference the TEXT primary keys they belong to.
  id: id(),
  documentId: text("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamps.createdAt,
}, (t) => ({
  orgIdx: index("kchunk_org_idx").on(t.organizationId),
  docIdx: index("kchunk_doc_idx").on(t.documentId),
  createdIdx: index("kchunk_created_idx").on(t.createdAt),
  embeddingIdx: index("kchunk_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
}));

// -----------------------------
// USAGE / AUDIT
// -----------------------------

export const usageRecords = pgTable("usage_records", {
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

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadataJson: text("metadata_json"),
  createdAt: timestamps.createdAt,
}, (t) => ({ orgIdx: index("audit_org_idx").on(t.organizationId, t.createdAt) }));

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(utcNowIso),
}, (t) => ({
  userIdx: index("prt_user_idx").on(t.userId),
  expiryIdx: index("prt_expiry_idx").on(t.expiresAt),
}));

// -----------------------------
// BUYER TABLES (saved, comparisons, visits, recently viewed)
// -----------------------------

// PostgreSQL mirrors of the buyer workspace tables (same table/column/index
// names, relationships, and per-user ownership boundaries as the SQLite
// port). Timestamps stay app-comparable ISO text like buyerPreferences.

export const buyerSavedProperties = pgTable("buyer_saved_properties", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  savedAt: text("saved_at").notNull().default(utcNowIso),
}, (t) => ({
  userIdx: index("bsp_user_idx").on(t.userId),
  propertyIdx: index("bsp_property_idx").on(t.propertyId),
  uniqueUserProperty: uniqueIndex("bsp_user_property_idx").on(t.userId, t.propertyId),
}));

export const buyerPropertyComparisons = pgTable("buyer_property_comparisons", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name"),
  propertyIds: text("property_ids").notNull(),
  createdAt: text("created_at").notNull().default(utcNowIso),
  updatedAt: text("updated_at").notNull().default(utcNowIso),
}, (t) => ({
  userIdx: index("bpc_user_idx").on(t.userId),
}));

export const buyerVisitRequests = pgTable("buyer_visit_requests", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  scheduledAt: text("scheduled_at").notNull(),
  status: text("status", { enum: ["REQUESTED", "SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"] }).notNull().default("REQUESTED"),
  agentId: text("agent_id").references(() => users.id),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(utcNowIso),
  updatedAt: text("updated_at").notNull().default(utcNowIso),
}, (t) => ({
  userIdx: index("bvr_user_idx").on(t.userId),
  propertyIdx: index("bvr_property_idx").on(t.propertyId),
  statusIdx: index("bvr_status_idx").on(t.status),
  scheduledIdx: index("bvr_scheduled_idx").on(t.scheduledAt),
}));

export const buyerRecentlyViewed = pgTable("buyer_recently_viewed", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  viewedAt: text("viewed_at").notNull().default(utcNowIso),
}, (t) => ({
  userIdx: index("brv_user_idx").on(t.userId),
  propertyIdx: index("brv_property_idx").on(t.propertyId),
  uniqueUserProperty: uniqueIndex("brv_user_property_idx").on(t.userId, t.propertyId),
}));

// -----------------------------
// TWO-FACTOR AUTHENTICATION (TOTP) — mirrors schema-sqlite.ts exactly.
// -----------------------------

export const twoFactorCredentials = pgTable("two_factor_credentials", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  secretEnc: text("secret_enc").notNull(),
  enabledAt: text("enabled_at"),
  createdAt: text("created_at").notNull().default(utcNowIso),
  updatedAt: text("updated_at").notNull().default(utcNowIso),
}, (t) => ({
  userIdx: uniqueIndex("tf_cred_user_idx").on(t.userId),
}));

export const twoFactorChallenges = pgTable("two_factor_challenges", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  verifiedAt: text("verified_at"),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(utcNowIso),
}, (t) => ({
  userIdx: index("tf_chal_user_idx").on(t.userId),
  expiryIdx: index("tf_chal_expiry_idx").on(t.expiresAt),
}));

export const twoFactorRecoveryCodes = pgTable("two_factor_recovery_codes", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull().default(utcNowIso),
}, (t) => ({
  userIdx: index("tf_rec_user_idx").on(t.userId),
}));

// -----------------------------
// BUYER PREFERENCES
// -----------------------------

export const buyerPreferences = pgTable("buyer_preferences", {
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
  createdAt: text("created_at").notNull().default(utcNowIso),
  updatedAt: text("updated_at").notNull().default(utcNowIso),
}, (t) => ({
  userIdx: uniqueIndex("bp_user_idx").on(t.userId),
}));
