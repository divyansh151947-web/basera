import "server-only";
import { listProperties } from "@/lib/data/properties";
import { analyzeInventoryGap, type InventoryGap, type InventoryProperty } from "./inventory-analysis";

export interface MatchCriteria {
  city?: string | null;
  preferredCity?: string | null;
  locality?: string | null;
  preferredLocality?: string | null;
  bhk?: number | null;
  propertyType?: string | null;
  budgetMinInr?: number | null;
  budgetMaxInr?: number | null;
  availability?: "AVAILABLE" | "LIMITED" | "UPCOMING" | "SOLD_OUT" | null;
}

/** The structural shape every candidate must have to be filtered + ranked. */
export interface MatchableProperty {
  city: string;
  locality: string;
  bhk: number | null;
  propertyType: string | null;
  priceMinInr: number;
  priceMaxInr: number;
  availability: string;
  isArchived?: boolean;
}

type DefaultPropertyRow = Awaited<ReturnType<typeof listProperties>>[number];

export interface PropertyMatch<T = DefaultPropertyRow> {
  property: T;
  matchType: "EXACT" | "CLOSE" | "ALTERNATIVE";
  matchScore: number;
  reasons: string[];
}

function normalizeMatchText(value?: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
}

function resolveCity(criteria: MatchCriteria): string | null {
  return criteria.city ?? criteria.preferredCity ?? null;
}

function resolveLocality(criteria: MatchCriteria): string | null {
  return criteria.locality ?? criteria.preferredLocality ?? null;
}

export function filterEligibleProperties<T extends MatchableProperty>(properties: T[], criteria: MatchCriteria): T[] {
  const requestedCity = normalizeMatchText(resolveCity(criteria));
  const requestedLocality = normalizeMatchText(resolveLocality(criteria));

  return properties.filter((p) => {
    if (p.isArchived) return false;
    if (p.availability === "SOLD_OUT") return false;

    if (requestedCity) {
      const propertyCity = normalizeMatchText(p.city);
      if (!propertyCity || !(propertyCity === requestedCity || propertyCity.includes(requestedCity) || requestedCity.includes(propertyCity))) {
        return false;
      }
    }

    if (requestedLocality) {
      const propertyLocality = normalizeMatchText(p.locality);
      if (!propertyLocality || !(propertyLocality === requestedLocality || propertyLocality.includes(requestedLocality) || requestedLocality.includes(propertyLocality))) {
        return false;
      }
    }

    if (criteria.bhk != null) {
      if (p.bhk == null || p.bhk !== criteria.bhk) return false;
    }

    if (criteria.propertyType && p.propertyType !== criteria.propertyType) {
      return false;
    }

    if (criteria.budgetMaxInr != null && p.priceMaxInr > criteria.budgetMaxInr) {
      return false;
    }

    if (criteria.budgetMinInr != null && p.priceMinInr < criteria.budgetMinInr) {
      return false;
    }

    if (criteria.availability && criteria.availability === "AVAILABLE" && p.availability !== "AVAILABLE") {
      return false;
    }

    return true;
  });
}

/**
 * Ranks already-eligible candidates. Shared by the strict path and the
 * relaxation ladder so scoring (and therefore matchType thresholds) is
 * identical everywhere.
 */
export function rankProperties<T extends MatchableProperty>(candidates: T[], criteria: MatchCriteria, limit = 5): Array<PropertyMatch<T>> {
  const requestedCity = resolveCity(criteria);
  const requestedLocality = resolveLocality(criteria);

  const scored: Array<PropertyMatch<T>> = candidates
    .map((p) => {
      let score = 0;
      const reasons: string[] = [];

      if (requestedCity && p.city.toLowerCase() === requestedCity.toLowerCase()) {
        score += 30;
        reasons.push("city match");
      }
      if (requestedLocality && p.locality.toLowerCase().includes(requestedLocality.toLowerCase())) {
        score += 15;
        reasons.push("locality match");
      }

      if (criteria.bhk != null) {
        if (p.bhk === criteria.bhk) {
          score += 25;
          reasons.push("exact BHK match");
        }
      }

      if (criteria.propertyType && p.propertyType === criteria.propertyType) {
        score += 10;
        reasons.push("property type match");
      }

      if (criteria.budgetMinInr != null || criteria.budgetMaxInr != null) {
        const leadMin = criteria.budgetMinInr ?? 0;
        const leadMax = criteria.budgetMaxInr ?? Number.MAX_SAFE_INTEGER;
        const overlaps = p.priceMinInr <= leadMax && p.priceMaxInr >= leadMin;
        if (overlaps) {
          score += 20;
          reasons.push("within budget");
        }
      }

      if (p.availability === "AVAILABLE") score += 5;
      if (p.availability === "LIMITED") score += 2;

      let matchType: PropertyMatch<T>["matchType"] = "ALTERNATIVE";
      if (score >= 70) matchType = "EXACT";
      else if (score >= 40) matchType = "CLOSE";

      return { property: p, matchType, matchScore: Math.max(0, Math.min(100, score)), reasons };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);

  return scored;
}

/**
 * Ranks the business's OWN property inventory against a lead's stated
 * requirements. Hard constraints are enforced before scoring so the system
 * never recommends a property that violates an explicit city/locality/BHK/
 * budget/property-type requirement.
 */
export async function matchProperties(organizationId: string, criteria: MatchCriteria, limit = 5): Promise<Array<PropertyMatch<DefaultPropertyRow>>> {
  const requestedCity = resolveCity(criteria);
  const requestedLocality = resolveLocality(criteria);
  const candidates = await listProperties(organizationId, {
    city: requestedCity ?? undefined,
    availability: undefined,
  });

  const eligible = filterEligibleProperties(candidates, { ...criteria, city: requestedCity, locality: requestedLocality });
  return rankProperties(eligible, criteria, limit);
}

export type PropertySearchMode = "STRICT" | "RELAXED_LOCALITY" | "RELAXED_BHK" | "RELAXED_BUDGET" | "NO_MATCH";

export interface PropertySearchResult<T = DefaultPropertyRow> {
  matches: Array<PropertyMatch<T>>;
  /** STRICT = every returned row satisfies every stated requirement.
   *  RELAXED_* = the stated constraint that was deliberately loosened; the
   *  caller MUST disclose it to the customer (never pretend it matches).
   *  NO_MATCH = nothing in inventory, even after relaxation. */
  mode: PropertySearchMode;
  gap: InventoryGap | null;
}

/**
 * Strict search first. When it comes back empty, walks a relaxation ladder —
 * locality, then BHK, then budget — always keeping the requested CITY hard,
 * because recommending another city unprompted is never what a buyer means.
 * Every relaxation is reported so replies can be honest about it.
 */
export async function searchProperties(
  organizationId: string,
  criteria: MatchCriteria,
  limit = 5
): Promise<PropertySearchResult<DefaultPropertyRow>> {
  const strict = await matchProperties(organizationId, criteria, limit);
  if (strict.length > 0) return { matches: strict, mode: "STRICT", gap: null };

  const all = await listProperties(organizationId);
  const gap = analyzeInventoryGap(all as unknown as InventoryProperty[], {
    preferredCity: resolveCity(criteria),
    preferredLocality: resolveLocality(criteria),
    bhk: criteria.bhk ?? null,
    propertyType: criteria.propertyType ?? null,
    budgetMinInr: criteria.budgetMinInr ?? null,
    budgetMaxInr: criteria.budgetMaxInr ?? null,
  });

  // 1. Softest constraint first: same city, same size, same budget — other locality.
  const withoutLocality = filterEligibleProperties(all, { ...criteria, locality: null, preferredLocality: null });
  if (withoutLocality.length > 0) {
    return { matches: rankProperties(withoutLocality, criteria, limit), mode: "RELAXED_LOCALITY", gap };
  }

  // 2. Stay inside the budget, but accept another size/type.
  const withoutBhk = filterEligibleProperties(all, { ...criteria, bhk: null, locality: null, preferredLocality: null });
  if (withoutBhk.length > 0) {
    return { matches: rankProperties(withoutBhk, criteria, limit), mode: "RELAXED_BHK", gap };
  }

  // 3. Last resort: the right size at a higher price, cheapest first, and the
  //    reply is required to state how far above budget it sits.
  const withoutBudget = filterEligibleProperties(all, {
    ...criteria,
    budgetMinInr: null,
    budgetMaxInr: null,
    locality: null,
    preferredLocality: null,
    bhk: null,
  });
  if (withoutBudget.length > 0) {
    const cheapestFirst = [...withoutBudget].sort((a, b) => a.priceMinInr - b.priceMinInr);
    return { matches: rankProperties(cheapestFirst, criteria, limit), mode: "RELAXED_BUDGET", gap };
  }

  return { matches: [], mode: "NO_MATCH", gap };
}