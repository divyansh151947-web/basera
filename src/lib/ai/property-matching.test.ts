import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { filterEligibleProperties } from "./property-matching";
import { buildNoExactMatchReply, inferIntent } from "./conversation-agent";
import { extractRequirements } from "./qualification";
import { checkHandoff } from "./handoff";

const properties = [
  {
    id: "gurgaon-3bhk-1",
    city: "Gurgaon",
    locality: "Sector 33, Sohna Road",
    bhk: 3,
    propertyType: "APARTMENT",
    priceMinInr: 12500000,
    priceMaxInr: 13800000,
    availability: "AVAILABLE",
    isArchived: false,
  },
  {
    id: "gurgaon-3bhk-2",
    city: "Gurgaon",
    locality: "Sector 57",
    bhk: 3,
    propertyType: "APARTMENT",
    priceMinInr: 16000000,
    priceMaxInr: 17500000,
    availability: "AVAILABLE",
    isArchived: false,
  },
  {
    id: "noida-3bhk",
    city: "Noida",
    locality: "Sector 150",
    bhk: 3,
    propertyType: "APARTMENT",
    priceMinInr: 8800000,
    priceMaxInr: 9600000,
    availability: "AVAILABLE",
    isArchived: false,
  },
  {
    id: "gurgaon-4bhk",
    city: "Gurgaon",
    locality: "Sector 57",
    bhk: 4,
    propertyType: "VILLA",
    priceMinInr: 32000000,
    priceMaxInr: 35000000,
    availability: "SOLD_OUT",
    isArchived: false,
  },
];

describe("property matching hard constraints", () => {
  it("Case A: 3 BHK + Gurgaon + <= ₹1.5 crore keeps only Gurgaon matches", () => {
    const matches = filterEligibleProperties(properties, {
      city: "Gurgaon",
      bhk: 3,
      budgetMaxInr: 15000000,
      propertyType: "APARTMENT",
    });

    expect(matches.map((p) => p.id)).toEqual(["gurgaon-3bhk-1"]);
    expect(matches.every((p) => p.city === "Gurgaon")).toBe(true);
  });

  it("Case B: Noida property must never be returned for a Gurgaon requirement", () => {
    const matches = filterEligibleProperties(properties, {
      city: "Gurgaon",
      bhk: 3,
      budgetMaxInr: 15000000,
      propertyType: "APARTMENT",
    });

    expect(matches.some((p) => p.city === "Noida")).toBe(false);
  });

  it("Case C: budget cap rejects properties above the user's maximum", () => {
    const matches = filterEligibleProperties(properties, {
      city: "Gurgaon",
      bhk: 3,
      budgetMaxInr: 15000000,
    });

    expect(matches.every((p) => p.priceMaxInr <= 15000000)).toBe(true);
    expect(matches.some((p) => p.id === "gurgaon-3bhk-2")).toBe(false);
  });

  it("Case D: when no exact match exists, the system says no exact match instead of recommending an invalid property", () => {
    const reply = buildNoExactMatchReply({ preferredCity: "Gurgaon", budgetMaxInr: 15000000 });

    expect(reply).toContain("exact match");
    expect(reply).toContain("Gurgaon");
    expect(reply).toContain("₹1.5 crore");
    expect(reply).not.toContain("Noida");
  });

  it("Case A regression: preferredCity fields must still enforce city and budget filters", () => {
    const matches = filterEligibleProperties(properties, {
      preferredCity: "Gurgaon",
      bhk: 3,
      budgetMaxInr: 15000000,
      propertyType: "APARTMENT",
    });

    expect(matches.map((p) => p.id)).toEqual(["gurgaon-3bhk-1"]);
    expect(matches.some((p) => p.city === "Noida")).toBe(false);
  });

  it("parses natural buyer input into valid lead requirements", async () => {
    const result = await extractRequirements("I am looking for a 3 BHK in Gurgaon under 1.5 crore.");

    expect(result.preferredCity).toBe("Gurgaon");
    expect(result.bhk).toBe(3);
    expect(result.budgetMaxInr).toBe(15000000);
  });

  it("classifies greetings and unclear input naturally", () => {
    // "hi there, I am looking for a home" has search intent, so it's PROPERTY_SEARCH not GREETING
    expect(inferIntent("hi there, I am looking for a home", [], {})).toBe("PROPERTY_SEARCH");
    expect(inferIntent("asdkjlasd", [], {})).toBe("INVALID_OR_UNCLEAR");
  });

  it("classifies follow-up questions with prior context as FOLLOW_UP", () => {
    const intent = inferIntent("tell me more about it", [], { preferredCity: "Gurgaon", bhk: 3, budgetMaxInr: 15000000 });
    expect(intent).toBe("FOLLOW_UP");
  });

  it("treats short acknowledgements as normal conversation, not errors", () => {
    expect(inferIntent("ok", [], {})).toBe("AFFIRMATION");
    expect(inferIntent("show me more", [], { preferredCity: "Delhi" })).toBe("FOLLOW_UP");
  });

  it("does not hand off the conversation just because the AI is still gathering details", () => {
    const handoff = checkHandoff({
      latestLeadMessage: "Delhi",
      leadScore: 10,
      hotThreshold: 80,
      aiConfidence: "uncertain",
      sentimentFlag: "neutral",
      requestsNegotiationOrCustomPrice: false,
      requestsHuman: false,
    });

    expect(handoff.shouldHandoff).toBe(false);
  });

  it("hands off a site-visit request and recognizes supported city typos", async () => {
    const handoff = checkHandoff({ latestLeadMessage: "I want to schedule a site visit", leadScore: 20, hotThreshold: 80, aiConfidence: "confident", sentimentFlag: "neutral", requestsNegotiationOrCustomPrice: false, requestsHuman: false });
    expect(handoff.shouldHandoff).toBe(true);
    await expect(extractRequirements("Need a flat in Jaiupr")).resolves.toMatchObject({ preferredCity: "Jaipur" });
  });
});
