// ==========================================================================
// SINGLE SCHEMA IMPORT SURFACE — every data module imports table objects
// from here ("@/db/schema") and never touches a dialect file directly.
// The active dialect's objects are re-exported 1:1 (identical table,
// column, and index names/shapes); only storage types differ between the
// SQLite port (schema-sqlite.ts) and the PostgreSQL port (schema-pg.ts).
// See src/db/client.ts for the matching driver selection.
// ==========================================================================

import { isPostgresDatabaseUrl } from "./dialect";
import * as sqliteSchema from "./schema-sqlite";
import * as pgSchema from "./schema-pg";

const active = (isPostgresDatabaseUrl() ? pgSchema : sqliteSchema) as unknown as typeof sqliteSchema;

export const plans = active.plans;
export const organizations = active.organizations;
export const subscriptions = active.subscriptions;
export const users = active.users;
export const properties = active.properties;
export const propertyUnits = active.propertyUnits;
export const leads = active.leads;
export const leadPropertyInterests = active.leadPropertyInterests;
export const leadScoreEvents = active.leadScoreEvents;
export const conversations = active.conversations;
export const messages = active.messages;
export const followUps = active.followUps;
export const appointments = active.appointments;
export const notes = active.notes;
export const tasks = active.tasks;
export const recoveryClaims = active.recoveryClaims;
export const voiceSessions = active.voiceSessions;
export const notifications = active.notifications;
export const integrations = active.integrations;
export const aiConfigs = active.aiConfigs;
export const scoringConfigs = active.scoringConfigs;
export const knowledgeDocuments = active.knowledgeDocuments;
export const knowledgeChunks = active.knowledgeChunks;
export const usageRecords = active.usageRecords;
export const auditLogs = active.auditLogs;
export const passwordResetTokens = active.passwordResetTokens;
export const buyerSavedProperties = active.buyerSavedProperties;
export const buyerPropertyComparisons = active.buyerPropertyComparisons;
export const buyerVisitRequests = active.buyerVisitRequests;
export const buyerRecentlyViewed = active.buyerRecentlyViewed;
export const buyerPreferences = active.buyerPreferences;
export const twoFactorCredentials = active.twoFactorCredentials;
export const twoFactorChallenges = active.twoFactorChallenges;
export const twoFactorRecoveryCodes = active.twoFactorRecoveryCodes;
export const workflowDefinitions = active.workflowDefinitions;
export const workflowExecutions = active.workflowExecutions;
