import "server-only";
import { db } from "@/db/client";
import { properties, organizations } from "@/db/schema";
import { and, eq, desc, asc, gte, lte, like, inArray, gt, sql } from "drizzle-orm";
import { likeContains } from "@/lib/safe-like";

export interface PropertyFilters {
  city?: string;
  bhk?: number;
  propertyType?: string;
  maxPrice?: number;
  minPrice?: number;
  availability?: string;
  developer?: string;
  search?: string;
  furnishing?: string;
  minArea?: number;
  maxArea?: number;
  possessionTimeline?: string;
  sortBy?: string;
}

/**
 * Organization IDs whose properties are publicly visible (the published
 * "basera" workspace plus any demo orgs). Shared by every public query so
 * eligibility can never drift between endpoints.
 */
async function getPublicOrgIds(): Promise<string[]> {
  const [baseraOrg, demoOrgs] = await Promise.all([
    db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, "basera")).limit(1),
    db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isDemo, true)),
  ]);
  return Array.from(new Set([...baseraOrg.map((o) => o.id), ...demoOrgs.map((o) => o.id)]));
}

export async function listProperties(organizationId: string, filters: PropertyFilters = {}, page?: { limit: number; offset: number }) {
  const conditions = [eq(properties.organizationId, organizationId), eq(properties.isArchived, false)];
  if (filters.city) conditions.push(eq(properties.city, filters.city));
  if (filters.bhk) conditions.push(eq(properties.bhk, filters.bhk));
  if (filters.propertyType) conditions.push(eq(properties.propertyType, filters.propertyType as any));
  if (filters.availability) conditions.push(eq(properties.availability, filters.availability as any));
  if (filters.developer) conditions.push(like(properties.developer, likeContains(filters.developer)));
  if (filters.maxPrice) conditions.push(lte(properties.priceMinInr, filters.maxPrice));
  if (filters.minPrice) conditions.push(gte(properties.priceMaxInr, filters.minPrice));
  if (filters.search) conditions.push(like(properties.projectName, likeContains(filters.search)));

  // When a page is given, fetch at most limit+1 rows so callers can derive
  // hasMore without scanning the whole table (same order as before).
  const q = db.select().from(properties).where(and(...conditions)).orderBy(desc(properties.updatedAt));
  if (page) return q.limit(page.limit + 1).offset(page.offset);
  return q;
}

export async function listPublicProperties(filters: PropertyFilters = {}, options: { limit?: number } = {}) {
  // Basera-org + demo-org lookups are independent — run concurrently.
  const [baseraOrg, demoOrgs] = await Promise.all([
    db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, "basera")).limit(1),
    db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isDemo, true)),
  ]);
  const demoOrgIds = demoOrgs.map((o) => o.id);
  
  // Combine org IDs - prefer Basera org, then demo orgs
  const baseraOrgIds = baseraOrg.map((o) => o.id);
  const orgIds = Array.from(new Set([...baseraOrgIds, ...demoOrgIds]));
  if (orgIds.length === 0) return [];

  const conditions = [
    eq(properties.isArchived, false),
    eq(properties.availability, "AVAILABLE" as any),
    inArray(properties.organizationId, orgIds),
  ];
  if (filters.city) conditions.push(eq(properties.city, filters.city));
  if (filters.bhk) conditions.push(eq(properties.bhk, filters.bhk));
  if (filters.propertyType) conditions.push(eq(properties.propertyType, filters.propertyType as any));
  if (filters.maxPrice) conditions.push(lte(properties.priceMinInr, filters.maxPrice));
  if (filters.minPrice) conditions.push(gte(properties.priceMaxInr, filters.minPrice));
  if (filters.search) {
    const searchTerm = likeContains(filters.search);
    conditions.push(
      sql`(
        ${properties.projectName} LIKE ${searchTerm} OR
        ${properties.city} LIKE ${searchTerm} OR
        ${properties.locality} LIKE ${searchTerm} OR
        ${properties.address} LIKE ${searchTerm} OR
        ${properties.developer} LIKE ${searchTerm}
      )`
    );
  }
  if (filters.furnishing) conditions.push(eq(properties.furnishing, filters.furnishing as any));
  if (filters.minArea) conditions.push(gte(properties.areaSqft, filters.minArea));
  if (filters.maxArea) conditions.push(lte(properties.areaSqft, filters.maxArea));
  if (filters.possessionTimeline) {
    const now = new Date().toISOString().split('T')[0];
    if (filters.possessionTimeline === "ready") {
      conditions.push(lte(properties.possessionDate, now));
    } else if (filters.possessionTimeline === "under_construction") {
      conditions.push(gt(properties.possessionDate, now));
    }
  }

  let orderBy = desc(properties.updatedAt);
  if (filters.sortBy) {
    switch (filters.sortBy) {
      case "price_asc":
        orderBy = asc(properties.priceMinInr);
        break;
      case "price_desc":
        orderBy = desc(properties.priceMinInr);
        break;
      case "area_desc":
        orderBy = desc(properties.areaSqft);
        break;
      case "newest":
        orderBy = desc(properties.createdAt);
        break;
      default:
        orderBy = desc(properties.updatedAt);
    }
  }

  // Optional SQL-level cap. Callers that only render a handful of rows (e.g.
  // "similar properties" on the detail page, which slices to 4) previously
  // scanned and materialised every matching row in the org set. Same ordering,
  // so the rows returned are still the top-N of the identical result set; when
  // no limit is given the behaviour is byte-for-byte the legacy one.
  const limit = options.limit && options.limit > 0 ? options.limit : undefined;

  const query = db
    .select({
      property: properties,
      organization: { id: organizations.id, name: organizations.name, slug: organizations.slug },
    })
    .from(properties)
    .innerJoin(organizations, eq(properties.organizationId, organizations.id))
    .where(and(...conditions))
    .orderBy(orderBy);

  return limit ? query.limit(limit) : query;
}

export async function getPublicCities(): Promise<string[]> {
  const [baseraOrg, demoOrgs] = await Promise.all([
    db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, "basera")).limit(1),
    db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isDemo, true)),
  ]);
  const demoOrgIds = demoOrgs.map((o) => o.id);
  
  // Combine org IDs - prefer Basera org, then demo orgs
  const baseraOrgIds = baseraOrg.map((o) => o.id);
  const orgIds = Array.from(new Set([...baseraOrgIds, ...demoOrgIds]));
  if (orgIds.length === 0) return [];

  const rows = await db
    .selectDistinct({ city: properties.city })
    .from(properties)
    .innerJoin(organizations, eq(properties.organizationId, organizations.id))
    .where(and(
      eq(properties.isArchived, false),
      eq(properties.availability, "AVAILABLE" as any),
      inArray(properties.organizationId, orgIds)
    ))
    .orderBy(properties.city);

  return rows.map(r => r.city).filter((c): c is string => typeof c === "string" && c.length > 0);
}

/**
 * Publicly visible properties that have an uploaded walkthrough video.
 *
 * Used by the homepage video showcase so it plays the business's REAL
 * published media (see src/lib/featured-video.ts for the selection rules).
 * Same eligibility as listPublicProperties: published orgs only, not
 * archived, availability AVAILABLE. Ordered newest-first with the id
 * tie-break so the caller's deterministic fallback is stable.
 */
export async function listPublicVideoProperties() {
  const orgIds = await getPublicOrgIds();
  if (orgIds.length === 0) return [];

  const rows = await db
    .select({
      id: properties.id,
      title: properties.projectName,
      city: properties.city,
      locality: properties.locality,
      videoUrl: properties.videoUrl,
      videoPosterUrl: properties.videoPosterUrl,
      createdAt: properties.createdAt,
    })
    .from(properties)
    .where(and(
      eq(properties.isArchived, false),
      eq(properties.availability, "AVAILABLE" as any),
      inArray(properties.organizationId, orgIds),
      // Exclude rows where a video URL was never uploaded (null) or cleared
      // to an empty string — both are "no video" for showcase purposes.
      sql`${properties.videoUrl} IS NOT NULL AND TRIM(${properties.videoUrl}) <> ''`
    ))
    .orderBy(desc(properties.createdAt), asc(properties.id));

  return rows;
}

/**
 * In-flight de-duplication for the public property detail read.
 *
 * The property detail route reads the same row twice per render: once from
 * `generateMetadata()` (for og:title/description/og:image) and once from the
 * page component body. Both run inside the SAME server render, so they race on
 * an identical query.
 *
 * Deliberately NOT a cache:
 *  - only promises currently in flight are shared;
 *  - the entry is removed the moment the promise settles (resolve OR reject),
 *    so there is no TTL, no staleness window, and nothing to invalidate;
 *  - the key is a public property id and the value is data that is already
 *    world-readable on this route (published demo-org/Basera-org properties
 *    only) — no session, tenant or PII ever passes through this map.
 */
const inFlightPublicProperty = new Map<string, Promise<Awaited<ReturnType<typeof fetchPublicPropertyRow>>>>();

async function fetchPublicPropertyRow(propertyId: string) {
  const [baseraOrg, demoOrgs] = await Promise.all([
    db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, "basera")).limit(1),
    db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isDemo, true)),
  ]);
  const demoOrgIds = demoOrgs.map((o) => o.id);

  // Combine org IDs - prefer Basera org, then demo orgs
  const baseraOrgIds = baseraOrg.map((o) => o.id);
  const orgIds = Array.from(new Set([...baseraOrgIds, ...demoOrgIds]));
  if (orgIds.length === 0) return null;

  const rows = await db
    .select({
      property: properties,
      organization: { id: organizations.id, name: organizations.name, slug: organizations.slug },
    })
    .from(properties)
    .innerJoin(organizations, eq(properties.organizationId, organizations.id))
    .where(and(eq(properties.id, propertyId), eq(properties.isArchived, false), eq(properties.availability, "AVAILABLE" as any), inArray(properties.organizationId, orgIds)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPublicPropertyById(propertyId: string) {
  const pending = inFlightPublicProperty.get(propertyId);
  if (pending) return pending;

  const promise = fetchPublicPropertyRow(propertyId).finally(() => {
    inFlightPublicProperty.delete(propertyId);
  });
  inFlightPublicProperty.set(propertyId, promise);
  return promise;
}

export async function getPropertyById(organizationId: string, propertyId: string) {
  const rows = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createProperty(organizationId: string, data: Partial<typeof properties.$inferInsert>) {
  // Same tenant-override hardening as leads: session org always wins.
  const { organizationId: _ignoredOrg, id: _ignoredId, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const [row] = await db
    .insert(properties)
    .values({ ...safeData, organizationId } as any)
    .returning();
  return row;
}

export async function updateProperty(organizationId: string, propertyId: string, data: Partial<typeof properties.$inferInsert>) {
  const { organizationId: _ignoredOrg, id: _ignoredId, createdAt: _ignoredCreated, ...safeData } = (data ?? {}) as Record<string, unknown>;
  const [row] = await db
    .update(properties)
    .set({ ...safeData, updatedAt: new Date().toISOString() } as any)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
    .returning();
  return row;
}

export async function archiveProperty(organizationId: string, propertyId: string) {
  return updateProperty(organizationId, propertyId, { isArchived: true });
}

export async function getRecommendedProperties(userId: string, preferences: { 
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
} | null) {
  // Build filters based on buyer preferences
  const filters: any = {};
  
  if (preferences) {
    if (preferences.preferredCity) filters.city = preferences.preferredCity;
    if (preferences.propertyType) filters.propertyType = preferences.propertyType;
    if (preferences.bhk) filters.bhk = preferences.bhk;
    if (preferences.budgetMaxInr) filters.maxPrice = preferences.budgetMaxInr;
    if (preferences.budgetMinInr) filters.minPrice = preferences.budgetMinInr;
    if (preferences.furnishing) filters.furnishing = preferences.furnishing;
    if (preferences.minAreaSqft) filters.minArea = preferences.minAreaSqft;
    if (preferences.maxAreaSqft) filters.maxArea = preferences.maxAreaSqft;
    if (preferences.possessionTimeline) filters.possessionTimeline = preferences.possessionTimeline;
  }

  // If no specific preferences, use general filters
  if (Object.keys(filters).length === 0) {
    filters.sortBy = "recommended";
  }

  const properties = await listPublicProperties(filters);
  return properties;
}
