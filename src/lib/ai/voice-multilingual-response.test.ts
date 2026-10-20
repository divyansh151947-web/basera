import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildLanguageInstruction,
  buildNaturalConversationReply,
  buildNoExactMatchReply,
  formatPropertyRecommendation,
} from "./conversation-agent";

const DEVANAGARI_RE = /[ऀ-ॿ]/;

describe("multilingual qualification responses", () => {
  const merged = { preferredCity: "Jaipur", bhk: 3 };

  it("1. Hindi qualification response (missing budget prompt)", () => {
    const reply = buildNaturalConversationReply("PROPERTY_SEARCH", "Mujhe Jaipur mein 3 BHK chahiye", merged, [], "hi");
    expect(reply).toMatch(DEVANAGARI_RE);
    expect(reply).toMatch(/बजट/);
    expect(reply).not.toBe("What is your approximate budget range?");
  });

  it("2. English qualification response (unchanged legacy text)", () => {
    const reply = buildNaturalConversationReply("PROPERTY_SEARCH", "I need a 3 BHK in Jaipur", merged, [], "en");
    expect(reply).toBe("What is your approximate budget range?");
    expect(reply).not.toMatch(DEVANAGARI_RE);
  });

  it("2b. default language is English (existing callers unaffected)", () => {
    const reply = buildNaturalConversationReply("PROPERTY_SEARCH", "I need a 3 BHK in Jaipur", merged, []);
    expect(reply).toBe("What is your approximate budget range?");
  });

  it("3. Hinglish qualification response (roman mix, no Devanagari)", () => {
    const reply = buildNaturalConversationReply(
      "PROPERTY_SEARCH", "Jaipur mein 3 BHK chahiye", merged, [], "hinglish"
    );
    expect(reply).toMatch(/budget/i);
    expect(reply).not.toMatch(DEVANAGARI_RE);
    expect(reply).not.toBe("What is your approximate budget range?");
  });
});

describe("multilingual general questions", () => {
  it("4. Hindi general question about Basera", () => {
    const reply = buildNaturalConversationReply("CASUAL_CONVERSATION", "Basera kya karta hai", {}, [], "hi");
    expect(reply).toMatch(DEVANAGARI_RE);
    expect(reply).toMatch(/मदद|खुशी/);
  });

  it("5. English general question about Basera", () => {
    const reply = buildNaturalConversationReply("CASUAL_CONVERSATION", "What does Basera do?", {}, [], "en");
    expect(reply).toContain("Basera AI");
    expect(reply).not.toMatch(DEVANAGARI_RE);
  });

  it("6. Hinglish general question about Basera", () => {
    const reply = buildNaturalConversationReply("CASUAL_CONVERSATION", "Basera kya karta hai?", {}, [], "hinglish");
    expect(reply).not.toMatch(DEVANAGARI_RE);
    expect(reply).toMatch(/madad|help|khushi/i);
  });
});

describe("multilingual no-match and recommendation replies", () => {
  it("Hindi no-exact-match uses Devanagari units", () => {
    const reply = buildNoExactMatchReply({ preferredCity: "Jaipur", budgetMaxInr: 8000000 }, "hi");
    expect(reply).toMatch(DEVANAGARI_RE);
    expect(reply).toContain("₹80 लाख");
  });

  it("Hinglish property recommendation keeps roman script", () => {
    const reply = formatPropertyRecommendation(
      { projectName: "Test Heights", locality: "Jhotwara", city: "Jaipur", priceMinInr: 5000000, priceMaxInr: 7000000, bhk: 3, propertyType: "APARTMENT" },
      "EXACT",
      92,
      "hinglish"
    );
    expect(reply).not.toMatch(DEVANAGARI_RE);
    expect(reply).toMatch(/site visit/i);
  });
});

describe("LLM system-prompt language instruction", () => {
  it("instructs Devanagari Hindi for hi", () => {
    const instruction = buildLanguageInstruction("hi");
    expect(instruction).toMatch(/Hindi/);
    expect(instruction).toMatch(/Devanagari/);
    expect(instruction).not.toMatch(/Roman script/);
  });

  it("instructs roman Hinglish mirroring for hinglish", () => {
    const instruction = buildLanguageInstruction("hinglish");
    expect(instruction).toMatch(/Hinglish/);
    expect(instruction).toMatch(/Roman script/);
    expect(instruction).not.toMatch(/Devanagari script\.$/);
  });

  it("instructs English by default", () => {
    expect(buildLanguageInstruction("en")).toMatch(/English/);
  });
});
