import "server-only";
import { listProperties } from "@/lib/data/properties";

export interface MatchCriteria {
  city?: string | null;
  locality?: string | null;
  bhk?: number | null;
  propertyType?: string | null;
  budgetMinInr?: number | null;
  budgetMaxInr?: number | null;
}

export interface PropertyMatch {
  property: Awaited<ReturnType<typeof listProperties>>[number];
  matchType: "EXACT" | "CLOSE" | "ALTERNATIVE";
  matchScore: number;
  reasons: string[];
}

/**
 * Ranks the business's OWN property inventory against a lead's stated
 * requirements. This never invents properties — it only ever returns rows
 * that exist in this organization's `properties` table, and never returns
 * SOLD_OUT/archived stock unless explicitly requested by the caller.
 */
export async function matchProperties(organizationId: string, criteria: MatchCriteria, limit = 5): Promise<PropertyMatch[]> {
  const candidates = await listProperties(organizationId, {
    city: criteria.city ?? undefined,
    availability: undefined, // we score availability instead of hard-filtering, so near-matches still surface
  });

  const scored: PropertyMatch[] = candidates
    .filter((p) => p.availability !== "SOLD_OUT")
    .map((p) => {
      let score = 0;
      const reasons: string[] = [];

      // Location (heaviest weight)
      if (criteria.city && p.city.toLowerCase() === criteria.city.toLowerCase()) {
        score += 30;
        reasons.push("city match");
      }
      if (criteria.locality && p.locality.toLowerCase().includes(criteria.locality.toLowerCase())) {
        score += 15;
        reasons.push("locality match");
      }

      // BHK
      if (criteria.bhk != null) {
        if (p.bhk === criteria.bhk) {
          score += 25;
          reasons.push("exact BHK match");
        } else if (p.bhk != null && Math.abs(p.bhk - criteria.bhk) === 1) {
          score += 10;
          reasons.push("close BHK match");
        }
      }

      // Property type
      if (criteria.propertyType && p.propertyType === criteria.propertyType) {
        score += 10;
        reasons.push("property type match");
      }

      // Budget overlap
      if (criteria.budgetMinInr != null || criteria.budgetMaxInr != null) {
        const leadMin = criteria.budgetMinInr ?? 0;
        const leadMax = criteria.budgetMaxInr ?? Number.MAX_SAFE_INTEGER;
        const overlaps = p.priceMinInr <= leadMax && p.priceMaxInr >= leadMin;
        if (overlaps) {
          score += 20;
          reasons.push("within budget");
        } else {
          // Penalize but don't exclude — lets "close" alternatives surface
          const gapPct =
            p.priceMinInr > leadMax
              ? (p.priceMinInr - leadMax) / leadMax
              : (leadMin - p.priceMaxInr) / Math.max(leadMin, 1);
          score -= Math.min(20, Math.round(gapPct * 40));
        }
      }

      // Availability nudge
      if (p.availability === "AVAILABLE") score += 5;
      if (p.availability === "LIMITED") score += 2;

      let matchType: PropertyMatch["matchType"] = "ALTERNATIVE";
      if (score >= 70) matchType = "EXACT";
      else if (score >= 40) matchType = "CLOSE";

      return { property: p, matchType, matchScore: Math.max(0, Math.min(100, score)), reasons };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);

  return scored;
}
