import "server-only";
import { db } from "@/db/client";
import { properties } from "@/db/schema";
import { and, eq, desc, gte, lte, like } from "drizzle-orm";

export interface PropertyFilters {
  city?: string;
  bhk?: number;
  propertyType?: string;
  maxPrice?: number;
  minPrice?: number;
  availability?: string;
  developer?: string;
  search?: string;
}

export async function listProperties(organizationId: string, filters: PropertyFilters = {}) {
  const conditions = [eq(properties.organizationId, organizationId), eq(properties.isArchived, false)];
  if (filters.city) conditions.push(eq(properties.city, filters.city));
  if (filters.bhk) conditions.push(eq(properties.bhk, filters.bhk));
  if (filters.propertyType) conditions.push(eq(properties.propertyType, filters.propertyType as any));
  if (filters.availability) conditions.push(eq(properties.availability, filters.availability as any));
  if (filters.developer) conditions.push(like(properties.developer, `%${filters.developer}%`));
  if (filters.maxPrice) conditions.push(lte(properties.priceMinInr, filters.maxPrice));
  if (filters.minPrice) conditions.push(gte(properties.priceMaxInr, filters.minPrice));
  if (filters.search) conditions.push(like(properties.projectName, `%${filters.search}%`));

  return db.select().from(properties).where(and(...conditions)).orderBy(desc(properties.updatedAt));
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
  const [row] = await db
    .insert(properties)
    .values({ organizationId, ...data } as any)
    .returning();
  return row;
}

export async function updateProperty(organizationId: string, propertyId: string, data: Partial<typeof properties.$inferInsert>) {
  const [row] = await db
    .update(properties)
    .set({ ...data, updatedAt: new Date().toISOString() } as any)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)))
    .returning();
  return row;
}

export async function archiveProperty(organizationId: string, propertyId: string) {
  return updateProperty(organizationId, propertyId, { isArchived: true });
}
