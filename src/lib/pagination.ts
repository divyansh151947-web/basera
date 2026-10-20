/**
 * Bounded list responses for staff collection endpoints.
 *
 * Collection GETs accept `?limit=` / `?offset=` and always answer with a
 * capped page plus `hasMore`, so an authenticated caller can never pull an
 * unbounded table in one response. Conventions mirror the knowledge
 * document listing (default 50, hard max 200). Malformed values fall back
 * to the defaults instead of erroring, so existing callers without paging
 * parameters keep working with a bounded first page.
 */

export const STAFF_LIST_DEFAULT_LIMIT = 50;
export const STAFF_LIST_MAX_LIMIT = 200;
export const STAFF_LIST_MAX_OFFSET = 100000;

export interface ParsedPagination {
  limit: number;
  offset: number;
}

function toNonNegativeInt(raw: string | null | undefined, fallback: number): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function parsePaginationParams(
  searchParams: { get(name: string): string | null },
  defaults: { limit?: number; maxLimit?: number } = {}
): ParsedPagination {
  const maxLimit = defaults.maxLimit ?? STAFF_LIST_MAX_LIMIT;
  const fallbackLimit = Math.min(defaults.limit ?? STAFF_LIST_DEFAULT_LIMIT, maxLimit);
  const limit = Math.min(toNonNegativeInt(searchParams.get("limit"), fallbackLimit) || fallbackLimit, maxLimit);
  const offset = Math.min(toNonNegativeInt(searchParams.get("offset"), 0), STAFF_LIST_MAX_OFFSET);
  return { limit, offset };
}

/** Slice an already-scoped row array into a bounded page (uniform contract). */
export function paginateList<T>(rows: T[], { limit, offset }: ParsedPagination): { items: T[]; hasMore: boolean } {
  const items = rows.slice(offset, offset + limit);
  return { items, hasMore: offset + limit < rows.length };
}
