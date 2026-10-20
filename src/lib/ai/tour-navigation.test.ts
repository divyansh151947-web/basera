import { describe, expect, it } from "vitest";
import {
  VOICE_ACTIONS,
  VOICE_TOUR_EVENT,
  detectVoiceAction,
  isKnownTourTarget,
  isVoiceConfirmationYes,
  voiceActionConfirmation,
} from "./tour-navigation";

describe("voice app navigation (fixed allowlist)", () => {
  it("routes English navigation commands to real routes", () => {
    expect(detectVoiceAction("Open recovery.")).toEqual({
      kind: "navigate", action: "recovery", to: "/recovery", section: "Revenue Recovery",
    });
    expect(detectVoiceAction("Show my leads.")).toEqual({
      kind: "navigate", action: "leads", to: "/leads", section: "Leads",
    });
    expect(detectVoiceAction("Open properties.")).toEqual({
      kind: "navigate", action: "properties", to: "/properties", section: "Properties",
    });
    expect(detectVoiceAction("Open appointments.")).toEqual({
      kind: "navigate", action: "appointments", to: "/appointments", section: "Appointments",
    });
    expect(detectVoiceAction("Show revenue intelligence.")).toEqual({
      kind: "navigate", action: "analytics", to: "/analytics", section: "Analytics",
    });
    expect(detectVoiceAction("Open conversations.")).toEqual({
      kind: "navigate", action: "conversations", to: "/conversations", section: "Conversations",
    });
    expect(detectVoiceAction("Open settings.")).toEqual({
      kind: "navigate", action: "settings", to: "/settings", section: "Settings",
    });
    expect(detectVoiceAction("Go to dashboard.")).toEqual({
      kind: "navigate", action: "dashboard", to: "/dashboard", section: "Dashboard",
    });
    expect(detectVoiceAction("Open AI.")).toEqual({
      kind: "navigate", action: "voice", to: "/voice", section: "Voice AI",
    });
  });

  it("routes Hindi/Hinglish navigation commands", () => {
    expect(detectVoiceAction("Recovery dikhao.")).toMatchObject({ kind: "navigate", to: "/recovery" });
    expect(detectVoiceAction("Leads dikhao.")).toMatchObject({ kind: "navigate", to: "/leads" });
    expect(detectVoiceAction("Properties dikhao.")).toMatchObject({ kind: "navigate", to: "/properties" });
    expect(detectVoiceAction("Appointments dikhao.")).toMatchObject({ kind: "navigate", to: "/appointments" });
    expect(detectVoiceAction("AI section kholo.")).toMatchObject({ kind: "navigate", to: "/voice" });
    expect(detectVoiceAction("Revenue intelligence kholo.")).toMatchObject({ kind: "navigate", to: "/analytics" });
    expect(detectVoiceAction("Settings kholo.")).toMatchObject({ kind: "navigate", to: "/settings" });
  });

  it("every allowlisted route is a known internal path (never model-generated)", () => {
    const known = new Set([
      "/dashboard", "/leads", "/properties", "/conversations", "/voice",
      "/appointments", "/recovery", "/analytics", "/settings", "/team",
      "/tour", "/",
    ]);
    for (const def of Object.values(VOICE_ACTIONS)) {
      expect(known.has(def.route)).toBe(true);
      expect(def.route).not.toMatch(/^https?:\/\//);
    }
  });

  it("go back resolves to history navigation", () => {
    expect(detectVoiceAction("Go back.")).toEqual({ kind: "back" });
    expect(detectVoiceAction("wapas jao")).toEqual({ kind: "back" });
  });

  it("destructive actions resolve to confirmation, never execution", () => {
    expect(detectVoiceAction("Delete this lead.")).toEqual({ kind: "confirm", confirm: "delete-lead" });
    expect(detectVoiceAction("Lead hatao.")).toEqual({ kind: "confirm", confirm: "delete-lead" });
    const yes = voiceActionConfirmation({ kind: "confirm", confirm: "delete-lead" }, "en");
    expect(yes).toMatch(/permanent/i);
    expect(isVoiceConfirmationYes("yes")).toBe(true);
    expect(isVoiceConfirmationYes("haan")).toBe(true);
    expect(isVoiceConfirmationYes("no")).toBe(false);
    expect(isVoiceConfirmationYes("delete it now")).toBe(false);
  });

  it("conversational and property-search text is not navigation", () => {
    expect(detectVoiceAction("How much is this property?")).toEqual({ kind: "none" });
    expect(detectVoiceAction("Show me 3 BHK properties.")).toEqual({ kind: "none" });
    expect(detectVoiceAction("Jaipur mein 3 BHK dikhao.")).toEqual({ kind: "none" });
    expect(detectVoiceAction("Show properties with a swimming pool.")).toEqual({ kind: "none" });
    expect(detectVoiceAction("Talk to an agent.")).toEqual({ kind: "none" });
    expect(detectVoiceAction("")).toEqual({ kind: "none" });
  });
});

describe("voice 3D tour navigation", () => {
  it("routes room views in English + Hindi/Hinglish", () => {
    expect(detectVoiceAction("Show me the swimming pool.")).toMatchObject({ kind: "tour", target: "pool" });
    expect(detectVoiceAction("Pool dikhao.")).toMatchObject({ kind: "tour", target: "pool" });
    expect(detectVoiceAction("Bedroom dikhao.")).toMatchObject({ kind: "tour", target: "bedroom" });
    expect(detectVoiceAction("Kitchen dikhao.")).toMatchObject({ kind: "tour", target: "kitchen" });
    expect(detectVoiceAction("Terrace dikhao.")).toMatchObject({ kind: "tour", target: "terrace" });
    expect(detectVoiceAction("Parking dikhao.")).toMatchObject({ kind: "tour", target: "parking" });
    expect(detectVoiceAction("Balcony dikhao.")).toMatchObject({ kind: "tour", target: "balcony" });
  });

  it("tour event name is stable for the 3D shell listener", () => {
    expect(VOICE_TOUR_EVENT).toBe("basera:voice-navigate");
    expect(isKnownTourTarget("pool")).toBe(true);
    expect(isKnownTourTarget("https://evil.example/x")).toBe(false);
    expect(isKnownTourTarget(undefined)).toBe(false);
  });

  it("confirmations speak the turn language", () => {
    const nav = { kind: "navigate", action: "recovery", to: "/recovery", section: "Revenue Recovery" } as const;
    expect(voiceActionConfirmation(nav, "en")).toBe("Opening Revenue Recovery.");
    expect(voiceActionConfirmation(nav, "hi")).toBe("Revenue Recovery khol raha hoon.");
    expect(voiceActionConfirmation(nav, "hinglish")).toBe("Revenue Recovery open kar raha hoon.");
    expect(voiceActionConfirmation({ kind: "none" }, "en")).toBeNull();
  });
});
