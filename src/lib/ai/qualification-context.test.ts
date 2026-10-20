import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractRequirements, parseContextualBudget } from "./qualification";
import { inferIntent } from "./conversation-agent";

describe("parseContextualBudget", () => {
  it("parses lakh answers", () => {
    expect(parseContextualBudget("80 lakh")).toBe(8000000);
  });

  it("parses compact units", () => {
    expect(parseContextualBudget("80L")).toBe(8000000);
    expect(parseContextualBudget("1.5 cr")).toBe(15000000);
  });

  it("treats bare small numbers as lakh", () => {
    expect(parseContextualBudget("80")).toBe(8000000);
  });

  it("reads bare thousands as raw rupees (rent-scale answers)", () => {
    expect(parseContextualBudget("2000")).toBe(2000);
    expect(parseContextualBudget("5000")).toBe(5000);
    expect(parseContextualBudget("99999")).toBe(99999);
  });

  it("accepts full INR figures", () => {
    expect(parseContextualBudget("8000000")).toBe(8000000);
  });

  it("rejects non-budget text", () => {
    expect(parseContextualBudget("hello")).toBeNull();
    expect(parseContextualBudget("")).toBeNull();
    expect(parseContextualBudget("2 BHK")).toBeNull();
  });
});

describe("conversational tolerance (rule-based fallback, no LLM key)", () => {
  it("understands word-number BHK answers", async () => {
    expect((await extractRequirements("three bedrooms")).bhk).toBe(3);
    expect((await extractRequirements("I need three BHK in Jaipur")).bhk).toBe(3);
  });

  it("understands Hindi numeral BHK", async () => {
    expect((await extractRequirements("मुझे तीन बीएचके चाहिए"))).toMatchObject({ bhk: 3 });
  });

  it("tolerates filler words around budget", async () => {
    expect((await extractRequirements("uhh around 80 lakh")).budgetMaxInr).toBe(8000000);
    expect((await extractRequirements("umm, 80 lacs"))).toMatchObject({ budgetMaxInr: 8000000 });
  });

  it("self-correction takes the latest BHK", async () => {
    expect((await extractRequirements("I want 3 BHK... actually 4 BHK"))).toMatchObject({ bhk: 4 });
  });

  it("self-correction takes the latest budget", async () => {
    expect((await extractRequirements("80 lakh... no, around 90 lakh"))).toMatchObject({ budgetMaxInr: 9000000 });
  });

  it("self-correction takes the latest purpose", async () => {
    expect((await extractRequirements("rent... no, I want to buy"))).toMatchObject({ purpose: "BUY" });
  });

  it("self-correction takes the latest city", async () => {
    expect((await extractRequirements("Jaipur... sorry Gurgaon"))).toMatchObject({ preferredCity: "Gurgaon" });
  });

  it("locality survives hesitant phrasing", async () => {
    const out = await extractRequirements("gurgaon... golf course road... umm somewhere around there");
    expect(out.preferredCity).toBe("Gurgaon");
    expect(out.preferredLocality).toMatch(/golf course road/i);
  });

  it("money phrases never become localities", async () => {
    const out = await extractRequirements("Budget around 80 lakh hai");
    expect(out.preferredLocality).toBeUndefined();
    expect(out.budgetMaxInr).toBe(8000000);
  });

  it("bare word-count answers are requirement updates after a BHK prompt, not unclear", () => {
    const history = [{ sender: "AI" as const, content: "What kind of property are you looking for — for example, 2 BHK or 3 BHK?" }];
    expect(inferIntent("three", history, {})).toBe("PROPERTY_REQUIREMENT_UPDATE");
    expect(inferIntent("2", history, {})).toBe("PROPERTY_REQUIREMENT_UPDATE");
    expect(inferIntent("three", [], {})).not.toBe("PROPERTY_REQUIREMENT_UPDATE");
  });
});
