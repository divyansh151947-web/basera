import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  INDIAN_LANGUAGE_PRIORITY,
  INDIAN_VOICE_CAPABILITIES,
  getLanguageCapability,
  isRoutableIndianLanguage,
} from "./voice-languages";

const PRIORITY_INDIAN = ["hi", "mr", "bn", "gu", "pa", "ta", "te", "kn", "ml", "or", "as", "ur", "en", "hinglish"];

describe("india-first language capability map (honest statuses)", () => {
  it("covers exactly the priority list plus experimental Rajasthani", () => {
    expect(Object.keys(INDIAN_VOICE_CAPABILITIES).sort()).toEqual([...PRIORITY_INDIAN, "rajasthani"].sort());
    expect(INDIAN_LANGUAGE_PRIORITY).toEqual(["hi", "mr", "bn", "gu", "pa", "ta", "te", "kn", "ml", "or", "as", "ur", "en", "hinglish"]);
  });

  it("only en/hi/hinglish route anywhere; nothing is silently hardcoded", () => {
    expect(isRoutableIndianLanguage("en")).toBe(true);
    expect(isRoutableIndianLanguage("hi")).toBe(true);
    expect(isRoutableIndianLanguage("hinglish")).toBe(true);
    for (const code of ["mr", "bn", "gu", "pa", "ta", "te", "kn", "ml", "or", "as", "ur", "rajasthani", "xx"]) {
      expect(isRoutableIndianLanguage(code)).toBe(false);
    }
    // No language routes to a paid API by configuration.
    for (const cap of Object.values(INDIAN_VOICE_CAPABILITIES)) {
      expect(cap.route).not.toBe("openai");
    }
  });

  it("ten unsupported languages name an unverified best candidate (never a claim)", () => {
    for (const code of ["mr", "bn", "gu", "pa", "ta", "te", "kn", "ml", "or", "as", "ur"]) {
      const cap = getLanguageCapability(code)!;
      expect(cap.status).toBe("unsupported");
      expect(cap.route).toBeNull();
      expect(cap.tested).toBe(false);
      expect(cap.goodQuality).toBeNull();
      expect(cap.bestCandidate).toMatch(/indic-parler-tts/);
      expect(cap.bestCandidate).toMatch(/unverified/);
    }
  });

  it("Rajasthani is experimental and unroutable (never quiet Hindi)", () => {
    const cap = getLanguageCapability("rajasthani")!;
    expect(cap.status).toBe("experimental");
    expect(cap.route).toBeNull();
    expect(cap.voice).toBeNull();
  });

  it("no quality is ever claimed without evaluation", () => {
    for (const cap of Object.values(INDIAN_VOICE_CAPABILITIES)) {
      expect(cap.goodQuality).toBeNull();
    }
  });

  it("generation-tested languages are marked tested (quality still unevaluated)", () => {
    expect(getLanguageCapability("en")?.tested).toBe(true);
    expect(getLanguageCapability("hi")?.tested).toBe(true);
    expect(getLanguageCapability("hinglish")?.tested).toBe(true);
    // Tested means audio generated — not listened quality.
    expect(getLanguageCapability("hi")?.goodQuality).toBeNull();
  });

  it("unknown codes resolve to null (caller fails explicitly)", () => {
    expect(getLanguageCapability("xx")).toBeNull();
    expect(getLanguageCapability("es")).toBeNull();
  });
});
