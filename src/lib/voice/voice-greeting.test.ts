import { describe, expect, it } from "vitest";
import { detectLanguageSwitch, VOICE_GREETING_TEXT } from "./voice-greeting";

describe("voice greeting + language switch (pure, no DB)", () => {
  it("9. greeting text is exactly the approved string", () => {
    expect(VOICE_GREETING_TEXT).toBe("Hello, how are you? What can I help you with?");
  });

  it("25. explicit Hindi requests switch to Hindi", () => {
    expect(detectLanguageSwitch("Hindi mein baat karo.")).toBe("hi");
    expect(detectLanguageSwitch("HINDI MEIN BAAT KARO")).toBe("hi");
    expect(detectLanguageSwitch("Please Hindi mein bolo")).toBe("hi");
    expect(detectLanguageSwitch("हिंदी में बात करो")).toBe("hi");
    expect(detectLanguageSwitch("हिन्दी में")).toBe("hi");
  });

  it("26. explicit English requests switch to English", () => {
    expect(detectLanguageSwitch("Speak in English.")).toBe("en");
    expect(detectLanguageSwitch("SPEAK IN ENGLISH PLEASE")).toBe("en");
    expect(detectLanguageSwitch("Talk in English")).toBe("en");
    expect(detectLanguageSwitch("English mein baat karo")).toBe("en");
  });

  it("ordinary Hinglish/Hindi/English without a switch phrase returns null", () => {
    expect(detectLanguageSwitch("Mujhe Jaipur mein 3 BHK chahiye.")).toBeNull();
    expect(detectLanguageSwitch("मुझे जयपुर में 3 BHK चाहिए।")).toBeNull();
    expect(detectLanguageSwitch("I want a 3 BHK in Jaipur.")).toBeNull();
    expect(detectLanguageSwitch("What is BHK?")).toBeNull();
    expect(detectLanguageSwitch("")).toBeNull();
    expect(detectLanguageSwitch("   ")).toBeNull();
  });

  it("regional languages are never claimed (null, not a guess)", () => {
    expect(detectLanguageSwitch("Marathi mein baat karo")).toBeNull();
    expect(detectLanguageSwitch("Bangla mein bolo")).toBeNull();
  });
});
