import { describe, expect, it } from "vitest";
import { formatDisplayDate, formatDisplayDateTime, formatInr } from "./formatters";

/**
 * Display-date determinism: server render and client hydration must agree
 * byte-for-byte regardless of runtime default locale/timezone (bare
 * toLocaleDateString() renders "16/10/2026" on Node vs "10/16/2026" on
 * Chrome and triggers React hydration error #425).
 */
describe("formatDisplayDate", () => {
  it("renders pinned en-IN UTC dates", () => {
    expect(formatDisplayDate("2026-10-16T09:20:00.000Z")).toBe("16/10/2026");
    expect(formatDisplayDate(new Date("2026-01-05T00:00:00.000Z"))).toBe("5/1/2026");
  });

  it("handles invalid input without throwing", () => {
    expect(formatDisplayDate(null)).toBe("—");
    expect(formatDisplayDate(undefined)).toBe("—");
    expect(formatDisplayDate("")).toBe("—");
    expect(formatDisplayDate("not-a-date")).toBe("—");
  });
});

describe("formatDisplayDateTime", () => {
  it("renders pinned date+time", () => {
    const out = formatDisplayDateTime("2026-10-16T09:20:00.000Z");
    expect(out).toContain("16/10/2026");
    expect(out).toContain("at");
  });

  it("handles invalid input without throwing", () => {
    expect(formatDisplayDateTime(null)).toBe("—");
    expect(formatDisplayDateTime("nope")).toBe("—");
  });
});

describe("formatInr (unchanged contract)", () => {
  it("still formats rupees and guards invalid input", () => {
    expect(formatInr(5000000)).toContain("50,00,000");
    expect(formatInr(null)).toBe("—");
    expect(formatInr(NaN)).toBe("—");
  });
});
