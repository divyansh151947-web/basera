import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  scoreLead,
  buildScoringInputs,
  parseTimelineToDays,
  answeredQuickly,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  type ScoringInputs,
} from "./lead-scoring";

describe("DEFAULT_WEIGHTS sum to 100", () => {
  it("weights are a complete 0-100 budget", () => {
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
    for (const [k, v] of Object.entries(DEFAULT_WEIGHTS)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe("scoreLead (transparent, explainable)", () => {
  const baseInputs: ScoringInputs = {
    hasBudget: true,
    hasLocation: true,
    hasBhkOrType: true,
    timelineWithinDays: 15,
    engagementMessageCount: 6,
    hasPropertyMatch: true,
    siteVisitInterest: true,
    loanRequired: true,
    respondedQuickly: true,
  };

  it("scores a fully-qualified lead at max", () => {
    const r = scoreLead(baseInputs);
    expect(r.score).toBe(100);
    expect(r.temperature).toBe("HOT");
    // Every factor should award its full max.
    expect(r.breakdown.every((b) => b.points === b.max)).toBe(true);
  });

  it("scores a lead with no information at zero (old unanswered lead message, no engagement count)", () => {
    const now = Date.parse("2026-09-20T12:00:00.000Z");
    // leadMessageCount 0 → no engagement points; an old unanswered message in the
    // thread → respondedQuickly false. Everything else empty.
    const inputs = buildScoringInputs({
      budgetMinInr: null,
      budgetMaxInr: null,
      preferredCity: null,
      bhk: null,
      propertyType: null,
      timeline: undefined,
      siteVisitInterest: null,
      loanRequired: null,
      leadMessageCount: 0,
      hasPropertyMatch: false,
      messages: [{ sender: "LEAD", createdAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() }],
    });
    expect(inputs.respondedQuickly).toBe(false);
    expect(inputs.engagementMessageCount).toBe(0);
    const r = scoreLead(inputs);
    expect(r.score).toBe(0);
    expect(r.temperature).toBe("COLD");
  });

  it("is not penalised on response when there are no lead messages yet", () => {
    // No lead messages → nothing has been missed → respondedQuickly stays true (+5).
    const r = scoreLead({
      hasBudget: false,
      hasLocation: false,
      hasBhkOrType: false,
      timelineWithinDays: null,
      engagementMessageCount: 0,
      hasPropertyMatch: false,
      siteVisitInterest: null,
      loanRequired: null,
      respondedQuickly: true,
    });
    expect(r.score).toBe(5);
    expect(r.temperature).toBe("COLD");
  });

  it("clamps score to 0-100", () => {
    const r = scoreLead({ ...baseInputs, engagementMessageCount: 1000 });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("temperature thresholds map correctly", () => {
    const hot = scoreLead({ ...baseInputs, timelineWithinDays: 5 });
    expect(hot.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.hot);
    expect(hot.temperature).toBe("HOT");

    const cold = scoreLead({
      hasBudget: false,
      hasLocation: false,
      hasBhkOrType: false,
      timelineWithinDays: null,
      engagementMessageCount: 0,
      hasPropertyMatch: false,
      siteVisitInterest: null,
      loanRequired: null,
      respondedQuickly: true,
    });
    expect(cold.temperature).toBe("COLD");
  });

  it("breakdown names every factor and its points", () => {
    const r = scoreLead(baseInputs);
    const factors = r.breakdown.map((b) => b.factor);
    expect(factors).toContain("Budget clarity");
    expect(factors).toContain("Requirement clarity");
    expect(factors).toContain("Buying timeline");
    expect(factors).toContain("Engagement");
    expect(factors).toContain("Property match");
    expect(factors).toContain("Site visit interest");
    expect(factors).toContain("Financing readiness");
    expect(factors).toContain("Response behavior");
    expect(r.breakdown.every((b) => b.points >= 0 && b.points <= b.max)).toBe(true);
  });

  it("respects custom weights", () => {
    const r = scoreLead(baseInputs, { ...DEFAULT_WEIGHTS, budgetClarity: 0 });
    const withBudget = scoreLead(baseInputs);
    expect(r.score).toBeLessThan(withBudget.score);
  });
});

describe("parseTimelineToDays", () => {
  it("parses months, weeks, days and keywords", () => {
    expect(parseTimelineToDays("2 months")).toBe(60);
    expect(parseTimelineToDays("3 weeks")).toBe(21);
    expect(parseTimelineToDays("10 days")).toBe(10);
    expect(parseTimelineToDays("immediate")).toBe(7);
    expect(parseTimelineToDays("asap")).toBe(7);
    expect(parseTimelineToDays("this month")).toBe(20);
    expect(parseTimelineToDays("next month")).toBe(45);
    expect(parseTimelineToDays(undefined)).toBeNull();
    expect(parseTimelineToDays("just browsing")).toBeNull();
  });
});

describe("buildScoringInputs", () => {
  it("derives boolean signals from raw state", () => {
    const inputs = buildScoringInputs({
      budgetMinInr: null,
      budgetMaxInr: 8_000_000,
      preferredCity: "Pune",
      bhk: null,
      propertyType: "APARTMENT",
      timeline: "2 months",
      siteVisitInterest: true,
      loanRequired: null,
      leadMessageCount: 3,
      hasPropertyMatch: false,
      messages: [],
    });
    expect(inputs.hasBudget).toBe(true);
    expect(inputs.hasLocation).toBe(true);
    expect(inputs.hasBhkOrType).toBe(true);
    expect(inputs.timelineWithinDays).toBe(60);
    expect(inputs.engagementMessageCount).toBe(3);
    expect(inputs.hasPropertyMatch).toBe(false);
  });

  it("treats missing timeline as null", () => {
    const inputs = buildScoringInputs({
      budgetMinInr: null,
      budgetMaxInr: null,
      preferredCity: null,
      bhk: null,
      propertyType: null,
      timeline: undefined,
      siteVisitInterest: null,
      loanRequired: null,
      leadMessageCount: 0,
      hasPropertyMatch: false,
      messages: [],
    });
    expect(inputs.hasBudget).toBe(false);
    expect(inputs.timelineWithinDays).toBeNull();
    expect(inputs.respondedQuickly).toBe(true); // no lead messages → not penalised
  });
});

describe("answeredQuickly (response behaviour signal)", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  const dayAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

  it("returns true when there are no lead messages", () => {
    expect(answeredQuickly([{ sender: "AGENT", createdAt: dayAgo(1) }], now)).toBe(true);
  });

  it("returns true when lead messages are answered within 24h", () => {
    const messages = [
      { sender: "LEAD", createdAt: dayAgo(2) },
      { sender: "AGENT", createdAt: dayAgo(1) },
    ];
    expect(answeredQuickly(messages, now)).toBe(true);
  });

  it("returns false when a lead message older than 24h has no reply", () => {
    const messages = [{ sender: "LEAD", createdAt: dayAgo(25) }];
    expect(answeredQuickly(messages, now)).toBe(false);
  });

  it("is lenient when at least half of judged messages were answered", () => {
    const messages = [
      { sender: "LEAD", createdAt: dayAgo(2) },   // answered → judged+answered
      { sender: "AGENT", createdAt: dayAgo(1.5) },
      { sender: "LEAD", createdAt: dayAgo(25) },  // unanswered, >24h → judged only
    ];
    // 2 judged, 1 answered → 0.5 → true (lenient threshold met).
    expect(answeredQuickly(messages, now)).toBe(true);
  });

  it("fails the half-answered threshold when most judged are unanswered", () => {
    const messages = [
      { sender: "LEAD", createdAt: dayAgo(25) },  // judged, unanswered (no agent reply exists)
      { sender: "LEAD", createdAt: dayAgo(30) },  // judged, unanswered
    ];
    // 2 judged, 0 answered → 0 → false.
    expect(answeredQuickly(messages, now)).toBe(false);
  });
});
