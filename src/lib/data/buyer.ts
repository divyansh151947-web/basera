import "server-only";
import { db } from "@/db/client";
import {
  buyerSavedProperties,
  buyerPropertyComparisons,
  buyerVisitRequests,
  buyerRecentlyViewed,
  buyerPreferences,
  properties,
  organizations,
} from "@/db/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { getPublicPropertyById } from "./properties";

export interface SavedProperty {
  propertyId: string;
  savedAt: string;
}

export interface Comparison {
  id: string;
  name: string | null;
  propertyIds: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisitRequest {
  id: string;
  propertyId: string;
  scheduledAt: string;
  status: "REQUESTED" | "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELED" | "NO_SHOW";
  agentId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecentlyViewed {
  propertyId: string;
  viewedAt: string;
}

export interface BuyerPreferences {
  budgetMinInr: number | null;
  budgetMaxInr: number | null;
  preferredCity: string | null;
  preferredLocality: string | null;
  propertyType: string | null;
  bhk: number | null;
  minAreaSqft: number | null;
  maxAreaSqft: number | null;
  furnishing: string | null;
  possessionTimeline: string | null;
  purpose: "BUY" | "RENT" | "INVEST" | null;
}

/**
 * Buyer Preferences
 */
export async function getBuyerPreferences(userId: string): Promise<BuyerPreferences | null> {
  const rows = await db
    .select()
    .from(buyerPreferences)
    .where(eq(buyerPreferences.userId, userId))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    budgetMinInr: row.budgetMinInr ?? null,
    budgetMaxInr: row.budgetMaxInr ?? null,
    preferredCity: row.preferredCity ?? null,
    preferredLocality: row.preferredLocality ?? null,
    propertyType: row.propertyType ?? null,
    bhk: row.bhk ?? null,
    minAreaSqft: row.minAreaSqft ?? null,
    maxAreaSqft: row.maxAreaSqft ?? null,
    furnishing: row.furnishing ?? null,
    possessionTimeline: row.possessionTimeline ?? null,
    purpose: row.purpose ?? null,
  };
}

export async function upsertBuyerPreferences(userId: string, data: Partial<BuyerPreferences>): Promise<void> {
  const existing = await getBuyerPreferences(userId);
  const updateData: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (data.budgetMinInr !== undefined) updateData.budgetMinInr = data.budgetMinInr;
  if (data.budgetMaxInr !== undefined) updateData.budgetMaxInr = data.budgetMaxInr;
  if (data.preferredCity !== undefined) updateData.preferredCity = data.preferredCity;
  if (data.preferredLocality !== undefined) updateData.preferredLocality = data.preferredLocality;
  if (data.propertyType !== undefined) updateData.propertyType = data.propertyType;
  if (data.bhk !== undefined) updateData.bhk = data.bhk;
  if (data.minAreaSqft !== undefined) updateData.minAreaSqft = data.minAreaSqft;
  if (data.maxAreaSqft !== undefined) updateData.maxAreaSqft = data.maxAreaSqft;
  if (data.furnishing !== undefined) updateData.furnishing = data.furnishing;
  if (data.possessionTimeline !== undefined) updateData.possessionTimeline = data.possessionTimeline;
  if (data.purpose !== undefined) updateData.purpose = data.purpose;

  if (existing) {
    await db
      .update(buyerPreferences)
      .set(updateData)
      .where(eq(buyerPreferences.userId, userId));
  } else {
    await db.insert(buyerPreferences).values({ userId, ...updateData });
  }
}

/**
 * Saved Properties
 */
export async function getSavedPropertyIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ propertyId: buyerSavedProperties.propertyId })
    .from(buyerSavedProperties)
    .where(eq(buyerSavedProperties.userId, userId))
    .orderBy(desc(buyerSavedProperties.savedAt));
  return rows.map((r) => r.propertyId);
}

export async function getSavedProperties(userId: string) {
  const rows = await db
    .select({
      property: properties,
      organization: { id: organizations.id, name: organizations.name, slug: organizations.slug },
      savedAt: buyerSavedProperties.savedAt,
    })
    .from(buyerSavedProperties)
    .innerJoin(properties, eq(buyerSavedProperties.propertyId, properties.id))
    .innerJoin(organizations, eq(properties.organizationId, organizations.id))
    .where(and(eq(buyerSavedProperties.userId, userId), eq(properties.isArchived, false)))
    .orderBy(desc(buyerSavedProperties.savedAt));
  return rows;
}

export async function saveProperty(userId: string, propertyId: string): Promise<void> {
  await db.insert(buyerSavedProperties).values({ userId, propertyId }).onConflictDoNothing();
}

export async function unsaveProperty(userId: string, propertyId: string): Promise<void> {
  await db
    .delete(buyerSavedProperties)
    .where(and(eq(buyerSavedProperties.userId, userId), eq(buyerSavedProperties.propertyId, propertyId)));
}

/** Remove every saved property for one buyer (Danger Zone "Delete All"). */
export async function clearSavedProperties(userId: string): Promise<void> {
  await db.delete(buyerSavedProperties).where(eq(buyerSavedProperties.userId, userId));
}

export async function isPropertySaved(userId: string, propertyId: string): Promise<boolean> {
  const rows = await db
    .select({ id: buyerSavedProperties.id })
    .from(buyerSavedProperties)
    .where(and(eq(buyerSavedProperties.userId, userId), eq(buyerSavedProperties.propertyId, propertyId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Property Comparisons
 *
 * Comparison rows are always scoped by the authenticated buyer (userId from
 * the session — never from request data). Property IDs are validated
 * against the same buyer-visibility rule as saved properties and visit
 * requests (getPublicPropertyById: not archived, AVAILABLE, basera/demo
 * orgs); unknown or invisible IDs are rejected with 404 semantics so one
 * tenant's private inventory can never leak through comparisons.
 */
export const COMPARISON_MIN_PROPERTIES = 2;
export const COMPARISON_MAX_PROPERTIES = 5;
export const COMPARISON_MAX_ID_LENGTH = 128;
export const COMPARISON_MAX_NAME_LENGTH = 120;

export type ComparisonInputError = { ok: false; status: 400 | 404; error: string };

export function validateComparisonName(name: unknown): { ok: true; value: string | null } | ComparisonInputError {
  if (name === undefined || name === null) return { ok: true, value: null };
  if (typeof name !== "string" || name.length > COMPARISON_MAX_NAME_LENGTH) {
    return { ok: false, status: 400, error: "Invalid comparison name" };
  }
  return { ok: true, value: name };
}

/** Validates shape + visibility of comparison property IDs (server-side). */
export async function resolveComparisonProperties(
  propertyIds: unknown
): Promise<{ ok: true; ids: string[] } | ComparisonInputError> {
  if (!Array.isArray(propertyIds) || propertyIds.length < COMPARISON_MIN_PROPERTIES) {
    return { ok: false, status: 400, error: "At least 2 property IDs are required for comparison" };
  }
  if (propertyIds.length > COMPARISON_MAX_PROPERTIES) {
    return { ok: false, status: 400, error: "Maximum 5 properties can be compared at once" };
  }
  const ids: string[] = [];
  for (const id of propertyIds) {
    if (typeof id !== "string" || id.length === 0 || id.length > COMPARISON_MAX_ID_LENGTH) {
      return { ok: false, status: 400, error: "Invalid property ID in comparison" };
    }
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) {
    return { ok: false, status: 400, error: "Duplicate property IDs in comparison" };
  }
  // Visibility checks are independent reads — run concurrently, then report
  // the first invisible id in request order (same outcome as sequential).
  const visibility = await Promise.all(ids.map((id) => getPublicPropertyById(id)));
  for (let i = 0; i < ids.length; i += 1) {
    if (!visibility[i]) {
      return { ok: false, status: 404, error: "Property not found or not available" };
    }
  }
  return { ok: true, ids };
}
export async function getComparisons(userId: string): Promise<Comparison[]> {
  const rows = await db
    .select()
    .from(buyerPropertyComparisons)
    .where(eq(buyerPropertyComparisons.userId, userId))
    .orderBy(desc(buyerPropertyComparisons.updatedAt));
  return rows.map(row => ({
    ...row,
    propertyIds: row.propertyIds,
  })) as Comparison[];
}

export async function getComparisonById(userId: string, comparisonId: string): Promise<Comparison | null> {
  const rows = await db
    .select()
    .from(buyerPropertyComparisons)
    .where(and(eq(buyerPropertyComparisons.userId, userId), eq(buyerPropertyComparisons.id, comparisonId)))
    .limit(1);
  if (rows.length === 0) return null;
  return {
    ...rows[0],
    propertyIds: rows[0].propertyIds,
  } as Comparison;
}

export async function createComparison(userId: string, name: string | null, propertyIds: string[]): Promise<Comparison> {
  if (!Array.isArray(propertyIds) || propertyIds.length < COMPARISON_MIN_PROPERTIES || propertyIds.length > COMPARISON_MAX_PROPERTIES) {
    throw new Error("Invalid comparison property list");
  }
  const [row] = await db
    .insert(buyerPropertyComparisons)
    .values({ userId, name, propertyIds: JSON.stringify(propertyIds) })
    .returning();
  return {
    ...row,
    propertyIds: JSON.stringify(propertyIds),
  } as Comparison;
}

export async function updateComparison(
  userId: string,
  comparisonId: string,
  data: { name?: string | null; propertyIds?: string[] }
): Promise<Comparison | null> {
  // Explicit allowlist: identity and timestamp fields can never be mass-assigned.
  const updateData: { name?: string | null; propertyIds?: string } = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.propertyIds !== undefined) {
    if (!Array.isArray(data.propertyIds)) throw new Error("Invalid comparison property list");
    updateData.propertyIds = JSON.stringify(data.propertyIds);
  }
  const [row] = await db
    .update(buyerPropertyComparisons)
    .set({ ...updateData, updatedAt: new Date().toISOString() })
    .where(and(eq(buyerPropertyComparisons.userId, userId), eq(buyerPropertyComparisons.id, comparisonId)))
    .returning();
  if (!row) return null;
  return {
    ...row,
    propertyIds: row.propertyIds,
  } as Comparison;
}

export async function deleteComparison(userId: string, comparisonId: string): Promise<boolean> {
  const result = await db
    .delete(buyerPropertyComparisons)
    .where(and(eq(buyerPropertyComparisons.userId, userId), eq(buyerPropertyComparisons.id, comparisonId)))
    .returning({ id: buyerPropertyComparisons.id });
  return result.length > 0;
}

export async function getComparisonProperties(userId: string, comparisonId: string) {
  const comparison = await getComparisonById(userId, comparisonId);
  if (!comparison) return [];

  // Guarded parse: a corrupted blob yields an empty list (404-shape downstream),
  // never a 500; non-string members can never reach the query.
  let propertyIds: unknown;
  try {
    propertyIds = JSON.parse(comparison.propertyIds);
  } catch {
    return [];
  }
  if (!Array.isArray(propertyIds)) return [];
  const ids = propertyIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) return [];
  
  const rows = await db
    .select({
      property: properties,
      organization: { id: organizations.id, name: organizations.name, slug: organizations.slug },
    })
    .from(properties)
    .innerJoin(organizations, eq(properties.organizationId, organizations.id))
    .where(and(inArray(properties.id, ids), eq(properties.isArchived, false)));

  // Reorder to match the comparison order
  const propertyMap = new Map(rows.map((r) => [r.property.id, r]));
  return ids.map((id) => propertyMap.get(id)).filter(Boolean);
}

/**
 * Visit Requests
 */
export async function getVisitRequests(userId: string) {
  const rows = await db
    .select({
      visit: buyerVisitRequests,
      property: {
        id: properties.id,
        projectName: properties.projectName,
        propertyType: properties.propertyType,
        bhk: properties.bhk,
        city: properties.city,
        locality: properties.locality,
        priceMinInr: properties.priceMinInr,
      },
    })
    .from(buyerVisitRequests)
    .leftJoin(properties, eq(buyerVisitRequests.propertyId, properties.id))
    .where(eq(buyerVisitRequests.userId, userId))
    .orderBy(desc(buyerVisitRequests.createdAt));
  
  return rows.map(row => ({
    ...row.visit,
    propertyName: row.property?.projectName ?? null,
    propertyType: row.property?.propertyType ?? null,
    bhk: row.property?.bhk ?? null,
    city: row.property?.city ?? null,
    locality: row.property?.locality ?? null,
    priceMinInr: row.property?.priceMinInr ?? null,
  }));
}

export async function getVisitRequestById(userId: string, visitId: string): Promise<VisitRequest | null> {
  const rows = await db
    .select()
    .from(buyerVisitRequests)
    .where(and(eq(buyerVisitRequests.userId, userId), eq(buyerVisitRequests.id, visitId)))
    .limit(1);
  return (rows[0] as VisitRequest) ?? null;
}

export async function createVisitRequest(
  userId: string,
  propertyId: string,
  scheduledAt: string,
  notes?: string
): Promise<VisitRequest> {
  const [row] = await db
    .insert(buyerVisitRequests)
    .values({ userId, propertyId, scheduledAt, notes })
    .returning();
  return row as VisitRequest;
}

export async function updateVisitRequest(
  userId: string,
  visitId: string,
  data: Partial<VisitRequest>
): Promise<VisitRequest | null> {
  const [row] = await db
    .update(buyerVisitRequests)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(and(eq(buyerVisitRequests.userId, userId), eq(buyerVisitRequests.id, visitId)))
    .returning();
  return (row as VisitRequest) ?? null;
}

export async function cancelVisitRequest(userId: string, visitId: string): Promise<void> {
  await db
    .update(buyerVisitRequests)
    .set({ status: "CANCELED", updatedAt: new Date().toISOString() })
    .where(and(eq(buyerVisitRequests.userId, userId), eq(buyerVisitRequests.id, visitId)));
}

/**
 * Recently Viewed Properties
 */
export async function getRecentlyViewedPropertyIds(userId: string, limit = 10): Promise<string[]> {
  const rows = await db
    .select({ propertyId: buyerRecentlyViewed.propertyId })
    .from(buyerRecentlyViewed)
    .where(eq(buyerRecentlyViewed.userId, userId))
    .orderBy(desc(buyerRecentlyViewed.viewedAt))
    .limit(limit);
  return rows.map((r) => r.propertyId);
}

export async function getRecentlyViewedProperties(userId: string, limit = 10) {
  const rows = await db
    .select({
      property: properties,
      organization: { id: organizations.id, name: organizations.name, slug: organizations.slug },
      viewedAt: buyerRecentlyViewed.viewedAt,
    })
    .from(buyerRecentlyViewed)
    .innerJoin(properties, eq(buyerRecentlyViewed.propertyId, properties.id))
    .innerJoin(organizations, eq(properties.organizationId, organizations.id))
    .where(and(eq(buyerRecentlyViewed.userId, userId), eq(properties.isArchived, false)))
    .orderBy(desc(buyerRecentlyViewed.viewedAt))
    .limit(limit);
  return rows;
}

export async function recordPropertyView(userId: string, propertyId: string): Promise<void> {
  // Delete any existing record for this user-property pair
  await db
    .delete(buyerRecentlyViewed)
    .where(and(eq(buyerRecentlyViewed.userId, userId), eq(buyerRecentlyViewed.propertyId, propertyId)));
  
  // Insert new record
  await db.insert(buyerRecentlyViewed).values({ userId, propertyId });
}

export async function clearRecentlyViewed(userId: string): Promise<void> {
  await db.delete(buyerRecentlyViewed).where(eq(buyerRecentlyViewed.userId, userId));
}