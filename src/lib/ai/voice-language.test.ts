import { describe, expect, it } from "vitest";
import { detectVoiceLanguage, localizeVoicePrompt, toReplyLanguage } from "./voice-language";

describe("voice language auto-detection", () => {
  it("1. detects English", () => {
    expect(detectVoiceLanguage("Show me properties in Jaipur.")).toEqual({ language: "en", confident: true });
    expect(detectVoiceLanguage("I want a 3 BHK in Jaipur under 80 lakh.")).toEqual({ language: "en", confident: true });
    expect(detectVoiceLanguage("Open recovery.")).toEqual({ language: "en", confident: true });
    expect(detectVoiceLanguage("What is my revenue at risk?")).toEqual({ language: "en", confident: true });
  });

  it("2. detects Hindi (Devanagari script)", () => {
    expect(detectVoiceLanguage("मुझे जयपुर में 3 BHK चाहिए।")).toEqual({ language: "hi", confident: true });
    expect(detectVoiceLanguage("बाथरूम दिखाओ")).toEqual({ language: "hi", confident: true });
  });

  it("3. detects Hindi (roman script)", () => {
    expect(detectVoiceLanguage("Jaipur mein 3 BHK dikhao.")).toEqual({ language: "hi", confident: true });
    expect(detectVoiceLanguage("Mujhe 80 lakh ke andar property chahiye.")).toEqual({ language: "hi", confident: true });
    expect(detectVoiceLanguage("Hindi mein baat karo.")).toEqual({ language: "hi", confident: true });
  });

  it("4. detects Hinglish mixes", () => {
    // Greeting-only English ("Hi") plus a Hindi-led sentence stays Hindi.
    expect(detectVoiceLanguage("Hi, mujhe Gurgaon mein 3 BHK chahiye.").language).toBe("hi");
    expect(detectVoiceLanguage("Show me pool dikhao.").language).toBe("hinglish");
    expect(detectVoiceLanguage("Bedroom dikhao.").language).toBe("hinglish");
  });

  it("5. low-confidence input retains the previous language", () => {
    expect(detectVoiceLanguage("80 lakh.", "hi")).toEqual({ language: "hi", confident: false });
    expect(detectVoiceLanguage("Jaipur.", "hi")).toEqual({ language: "hi", confident: false });
    expect(detectVoiceLanguage("3.", "en")).toEqual({ language: "en", confident: false });
    expect(detectVoiceLanguage("", "hinglish")).toEqual({ language: "hinglish", confident: false });
    expect(detectVoiceLanguage("   ")).toEqual({ language: "en", confident: false });
  });

  it("6. English greetings stay English", () => {
    expect(detectVoiceLanguage("Hello").language).toBe("en");
    expect(detectVoiceLanguage("Talk to an agent").language).toBe("en");
  });
});

describe("voice prompt localization (exact-match only)", () => {
  it("localizes the known missing-requirement prompts", () => {
    expect(localizeVoicePrompt("Sure! Which city or area are you looking in?", "hi")).toBe(
      "बिल्कुल! आप किस शहर या एरिया में देख रहे हैं?"
    );
    expect(localizeVoicePrompt("What is your approximate budget range?", "hi")).toBe(
      "आपका लगभग बजट क्या है?"
    );
    expect(localizeVoicePrompt("What is your approximate budget range?", "hinglish")).toBe(
      "Aapka approximate budget kya hai?"
    );
  });

  it("passes everything else through untouched", () => {
    const other = "Happy to help. Tell me what kind of property you're looking for.";
    expect(localizeVoicePrompt(other, "hi")).toBe(other);
    expect(localizeVoicePrompt(other, "hinglish")).toBe(other);
    expect(localizeVoicePrompt("What is your approximate budget range?", "en")).toBe(
      "What is your approximate budget range?"
    );
  });

  it("toReplyLanguage narrows tags safely", () => {
    expect(toReplyLanguage("hi")).toBe("hi");
    expect(toReplyLanguage("hinglish")).toBe("hinglish");
    expect(toReplyLanguage("en")).toBe("en");
    expect(toReplyLanguage("mr")).toBe("en");
    expect(toReplyLanguage(undefined)).toBe("en");
  });
});
