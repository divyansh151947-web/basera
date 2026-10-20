import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { inferIntent, buildNaturalConversationReply } from "./conversation-agent";

type Msg = { sender: "LEAD" | "AI" | "AGENT" | "SYSTEM"; content: string };

const emptyHistory: Msg[] = [];

function replyFor(message: string, history: Msg[] = emptyHistory, merged: Record<string, unknown> = {}) {
  const intent = inferIntent(message, history, merged);
  return { intent, reply: buildNaturalConversationReply(intent, message, merged, history) };
}

describe("greetings never hit the generic fallback", () => {
  for (const greeting of ["hi", "hello", "hey"]) {
    it(`"${greeting}" is a GREETING with a natural reply`, () => {
      const { intent, reply } = replyFor(greeting);
      expect(intent).toBe("GREETING");
      expect(reply).not.toContain("quite catch");
      expect(reply).not.toContain("Tell me the city, BHK, or budget");
    });
  }
});

describe("thanks and goodbye", () => {
  it('"thanks" is THANKS with a welcome reply', () => {
    const { intent, reply } = replyFor("thanks");
    expect(intent).toBe("THANKS");
    expect(reply.toLowerCase()).toContain("welcome");
  });

  it('"bye" is GOODBYE with a goodbye reply', () => {
    const { intent, reply } = replyFor("bye");
    expect(intent).toBe("GOODBYE");
    expect(reply.toLowerCase()).toContain("goodbye");
  });
});

describe("general real-estate questions get answers, not interrogation", () => {
  it('"What is BHK?" explains BHK without demanding city/budget', () => {
    const { intent, reply } = replyFor("What is BHK?");
    expect(intent).toBe("GENERAL_REAL_ESTATE_QUESTION");
    expect(reply).toContain("Bedroom");
    expect(reply).not.toContain("Which city");
  });

  it('"What does BHK mean?" explains the acronym', () => {
    const { intent, reply } = replyFor("What does BHK mean?");
    expect(intent).toBe("GENERAL_REAL_ESTATE_QUESTION");
    expect(reply).toContain("Bedroom, Hall, and Kitchen");
  });

  it('"What can you do?" describes capabilities', () => {
    const { reply } = replyFor("What can you do?");
    expect(reply.toLowerCase()).toContain("site visit");
  });
});

describe("property searches enter the qualification pipeline", () => {
  it('"I want a 2 BHK in Gurgaon" routes to property search', () => {
    const { intent, reply } = replyFor("I want a 2 BHK in Gurgaon");
    expect(["PROPERTY_SEARCH", "PROPERTY_REQUIREMENT_UPDATE"]).toContain(intent);
    expect(reply).not.toContain("quite catch");
  });
});

describe("short contextual replies use conversation history", () => {
  const cityPrompt: Msg[] = [{ sender: "AI", content: "Sure! Which city or area are you looking in?" }];

  it('"Gurgaon" after a city question is not unclear', () => {
    const { intent, reply } = replyFor("Gurgaon", cityPrompt, { preferredCity: "Gurgaon" });
    expect(intent).not.toBe("INVALID_OR_UNCLEAR");
    expect(reply).not.toContain("quite catch");
  });

  it('"2" after a BHK question is a requirement update, not a fallback', () => {
    const bhkPrompt: Msg[] = [{ sender: "AI", content: "What kind of property are you looking for — for example, 2 BHK or 3 BHK?" }];
    const { intent, reply } = replyFor("2", bhkPrompt, { bhk: 2 });
    expect(intent).toBe("PROPERTY_REQUIREMENT_UPDATE");
    expect(reply).not.toContain("quite catch");
  });

  it('"80 lakh" after a budget question is a requirement update', () => {
    const budgetPrompt: Msg[] = [{ sender: "AI", content: "What is your approximate budget range?" }];
    const { intent, reply } = replyFor("80 lakh", budgetPrompt, { budgetMaxInr: 8000000 });
    expect(intent).toBe("PROPERTY_REQUIREMENT_UPDATE");
    expect(reply).not.toContain("quite catch");
  });
});

describe("genuinely unclear messages get clarification, never an endless loop", () => {
  it('"asdfghjkl" asks for clarification once…', () => {
    const { intent, reply } = replyFor("asdfghjkl");
    expect(intent).toBe("INVALID_OR_UNCLEAR");
    expect(reply).toContain("buy, rent, or invest");
  });

  it("…and escalates instead of repeating the same fallback", () => {
    const history: Msg[] = [
      { sender: "LEAD", content: "asdfghjkl" },
      { sender: "AI", content: "I didn’t quite catch that 😄. Are you looking for a property to buy, rent, or invest in?" },
    ];
    const first = buildNaturalConversationReply("INVALID_OR_UNCLEAR", "zzzzzz", {}, history);
    expect(first).not.toContain("buy, rent, or invest in?");
    expect(first.toLowerCase()).toContain("specialist");
  });
});
