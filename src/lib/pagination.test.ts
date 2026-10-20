import { describe, expect, it } from "vitest";
import {
  parsePaginationParams,
  paginateList,
  STAFF_LIST_DEFAULT_LIMIT,
  STAFF_LIST_MAX_LIMIT,
} from "./pagination";

function sp(params: Record<string, string>): { get(name: string): string | null } {
  return { get: (name: string) => (name in params ? params[name] : null) };
}

describe("parsePaginationParams", () => {
  it("defaults when absent", () => {
    expect(parsePaginationParams(sp({}))).toEqual({ limit: STAFF_LIST_DEFAULT_LIMIT, offset: 0 });
  });

  it("honors valid values and clamps the maximum", () => {
    expect(parsePaginationParams(sp({ limit: "10", offset: "20" }))).toEqual({ limit: 10, offset: 20 });
    expect(parsePaginationParams(sp({ limit: "99999" })).limit).toBe(STAFF_LIST_MAX_LIMIT);
  });

  it("falls back on malformed input instead of erroring", () => {
    expect(parsePaginationParams(sp({ limit: "abc" })).limit).toBe(STAFF_LIST_DEFAULT_LIMIT);
    expect(parsePaginationParams(sp({ limit: "-5" })).limit).toBe(STAFF_LIST_DEFAULT_LIMIT);
    expect(parsePaginationParams(sp({ offset: "-3" })).offset).toBe(0);
    expect(parsePaginationParams(sp({ limit: "0" })).limit).toBe(STAFF_LIST_DEFAULT_LIMIT);
    expect(parsePaginationParams(sp({ limit: "2.7" })).limit).toBe(2);
  });
});

describe("paginateList", () => {
  const rows = [1, 2, 3, 4, 5];
  it("slices pages and reports hasMore", () => {
    expect(paginateList(rows, { limit: 2, offset: 0 })).toEqual({ items: [1, 2], hasMore: true });
    expect(paginateList(rows, { limit: 2, offset: 4 })).toEqual({ items: [5], hasMore: false });
    expect(paginateList(rows, { limit: 10, offset: 0 })).toEqual({ items: rows, hasMore: false });
    expect(paginateList(rows, { limit: 2, offset: 99 })).toEqual({ items: [], hasMore: false });
  });
});
