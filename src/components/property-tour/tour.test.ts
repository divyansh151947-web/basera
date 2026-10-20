import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("server-only", () => ({}));

import { CAMERA_PRESETS, HOTSPOTS, NAV_ORDER } from "./tour-types";
import { detectLowPowerDevice, easeInOutCubic, frameStride, isCoarseViewport, lerp, prefersReducedMotion, resolveTourEnv } from "./tour-env";
import { DOOR_DOLLY_MS, FLIGHT_MS, startFlight, stepFlight } from "./tour-camera";
import { routeTourCommand } from "./tour-command";
import { JOURNEY_CAMERAS, JOURNEY_STAGES, journeyCamera, journeyOrbitAngle, stageForProgress } from "./tour-journey";

describe("tour easing + camera flights (deterministic)", () => {
  it("easeInOutCubic is bounded and monotonic", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(-5)).toBe(0);
    expect(easeInOutCubic(9)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 20; i += 1) {
      const v = easeInOutCubic(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(lerp(2, 8, 0.5)).toBe(5);
  });

  it("flights interpolate and always land exactly on target", () => {
    const flight = startFlight(CAMERA_PRESETS.door, "living", FLIGHT_MS);
    let state = stepFlight(flight, FLIGHT_MS / 2);
    expect(state.done).toBe(false);
    expect(state.pos.x).toBeGreaterThan(CAMERA_PRESETS.living.pos.x - 3);
    state = stepFlight(flight, FLIGHT_MS / 2 + 1);
    expect(state.done).toBe(true);
    expect(state.pos).toEqual(CAMERA_PRESETS.living.pos);
    expect(state.look).toEqual(CAMERA_PRESETS.living.look);
  });

  it("zero-duration flights jump instantly (reduced-motion path)", () => {
    const flight = startFlight(CAMERA_PRESETS.door, "pool", 0);
    const state = stepFlight(flight, 0);
    expect(state.done).toBe(true);
    expect(state.pos).toEqual(CAMERA_PRESETS.pool.pos);
  });

  it("door dolly constant is a slow cinematic move", () => {
    expect(DOOR_DOLLY_MS).toBeGreaterThanOrEqual(2500);
    expect(FLIGHT_MS).toBeGreaterThanOrEqual(1500);
  });

  it("every nav target and hotspot target has a camera preset", () => {
    for (const item of NAV_ORDER) {
      expect(CAMERA_PRESETS[item.id]).toBeDefined();
    }
    for (const hs of HOTSPOTS) {
      expect(CAMERA_PRESETS[hs.target]).toBeDefined();
      expect(hs.visibleFrom.length).toBeGreaterThan(0);
    }
  });
});

describe("tour environment tiers", () => {
  it("mobile widths simplify; desktop keeps quality", () => {
    expect(isCoarseViewport(390)).toBe(true);
    expect(isCoarseViewport(1280)).toBe(false);
    const mobile = resolveTourEnv(390, 3);
    expect(mobile.pixelRatio).toBeLessThanOrEqual(1.5);
    expect(mobile.shadows).toBe(false);
    const desktop = resolveTourEnv(1440, 2);
    expect(desktop.pixelRatio).toBeLessThanOrEqual(2);
  });

  it("node (no DOM) reports no WebGL and no reduced-motion safely", () => {
    expect(prefersReducedMotion()).toBe(false);
    const env = resolveTourEnv(1280, 1);
    expect(env.simplified).toBe(true);
    expect(env.shadows).toBe(false);
  });

  it("adaptive tiers: unknown hardware never downgrades; weak hardware maps to LOW", () => {
    // Node has no navigator → full-signal absent → never low-power.
    expect(detectLowPowerDevice()).toBe(false);
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
    expect(detectLowPowerDevice()).toBe(false);
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    expect(detectLowPowerDevice()).toBe(true);
    vi.stubGlobal("navigator", { hardwareConcurrency: 12, deviceMemory: 3 });
    expect(detectLowPowerDevice()).toBe(true);
    vi.unstubAllGlobals();
    expect(detectLowPowerDevice()).toBe(false);
  });

  it("frame stride halves GPU on LOW while HIGH renders every frame", () => {
    expect(frameStride(false)).toBe(1);
    expect(frameStride(true)).toBe(2);
  });
});

describe("tour command router (English + Hindi)", () => {
  it("routes explicit room navigation", () => {
    expect(routeTourCommand("Show me the living room")).toEqual({ kind: "goto", target: "living" });
    expect(routeTourCommand("pool")).toEqual({ kind: "goto", target: "pool" });
    expect(routeTourCommand("Swimming pool dikhao")).toEqual({ kind: "goto", target: "pool" });
    expect(routeTourCommand("bedroom")).toEqual({ kind: "goto", target: "bedroom" });
    expect(routeTourCommand("parking kaha hai?")).toEqual({ kind: "goto", target: "parking" });
    expect(routeTourCommand("terrace")).toEqual({ kind: "goto", target: "terrace" });
    expect(routeTourCommand("kitchen dikhao")).toEqual({ kind: "goto", target: "kitchen" });
  });

  it("routes every remaining room in English + Hindi/Hinglish", () => {
    expect(routeTourCommand("Bathroom dikhao")).toEqual({ kind: "goto", target: "bathroom" });
    expect(routeTourCommand("washroom kaha hai?")).toEqual({ kind: "goto", target: "bathroom" });
    expect(routeTourCommand("balcony dikhao")).toEqual({ kind: "goto", target: "balcony" });
    expect(routeTourCommand("garden dikhao")).toEqual({ kind: "goto", target: "garden" });
    expect(routeTourCommand("aangan dikhao")).toEqual({ kind: "goto", target: "garden" });
    expect(routeTourCommand("hall dikhao")).toEqual({ kind: "goto", target: "living" });
    expect(routeTourCommand("rooftop dikhao")).toEqual({ kind: "goto", target: "rooftop" });
    expect(routeTourCommand("top floor")).toEqual({ kind: "goto", target: "rooftop" });
    expect(routeTourCommand("Show me the bedroom")).toEqual({ kind: "goto", target: "bedroom" });
    expect(routeTourCommand("Show me the terrace")).toEqual({ kind: "goto", target: "terrace" });
    expect(routeTourCommand("Bedroom dikhao.")).toEqual({ kind: "goto", target: "bedroom" });
  });

  it("routes exterior and city views", () => {
    expect(routeTourCommand("Show me the exterior")).toEqual({ kind: "goto", target: "exterior" });
    expect(routeTourCommand("exterior dikhao")).toEqual({ kind: "goto", target: "exterior" });
    expect(routeTourCommand("bahar dikhao")).toEqual({ kind: "goto", target: "exterior" });
    expect(routeTourCommand("Take me to the city")).toEqual({ kind: "goto", target: "tower" });
  });

  it("routes building/floor requests to the tower view", () => {
    expect(routeTourCommand("Show me the building")).toEqual({ kind: "goto", target: "tower" });
    expect(routeTourCommand("penthouse")).toEqual({ kind: "goto", target: "tower" });
  });

  it("passes real questions to the AI pipeline untouched", () => {
    const q = routeTourCommand("How much is this property?");
    expect(q.kind).toBe("question");
    if (q.kind === "question") expect(q.text).toBe("How much is this property?");
    expect(routeTourCommand("Tell me about Jhotwara in detail please")).toEqual({
      kind: "question",
      text: "Tell me about Jhotwara in detail please",
    });
    expect(routeTourCommand("")).toEqual({ kind: "question", text: "" });
  });
});

describe("journey scroll staging (deterministic)", () => {
  it("progress maps across all five stages in order", () => {
    expect(JOURNEY_STAGES).toHaveLength(5);
    expect(JOURNEY_CAMERAS).toHaveLength(5);
    expect(stageForProgress(0)).toBe(0);
    expect(stageForProgress(0.2)).toBe(1);
    expect(stageForProgress(0.5)).toBe(2);
    expect(stageForProgress(0.99)).toBe(4);
    expect(stageForProgress(-2)).toBe(0);
    expect(stageForProgress(99)).toBe(4);
    let prev = -1;
    for (let i = 0; i <= 60; i += 1) {
      const s = stageForProgress(i / 60);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("camera blends continuously between keys and ends exact", () => {
    const start = journeyCamera(0);
    expect(start.pos).toEqual(JOURNEY_CAMERAS[0].pos);
    const end = journeyCamera(1);
    expect(end.pos).toEqual(JOURNEY_CAMERAS[JOURNEY_CAMERAS.length - 1].pos);
    const mid = journeyCamera(0.35);
    expect(Number.isFinite(mid.pos.x + mid.pos.y + mid.pos.z)).toBe(true);
    expect(journeyOrbitAngle(0)).toBe(0);
    expect(journeyOrbitAngle(10)).toBeGreaterThan(journeyOrbitAngle(0));
  });

  it("stages carry no fabricated revenue claims", () => {
    // Illustrative demo inventory (₹/Cr showcase prices) is marketing
    // visualization, not a revenue promise; forbid only revenue/ROI claims.
    const json = JSON.stringify(JOURNEY_STAGES);
    expect(json).not.toMatch(/recovered|guarantee|ROI|percent/i);
  });
});

describe("landing integration (3D experience is the homepage)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(resolve(here, "..", "..", "app", "page.tsx"), "utf8");

  it("landing opens the interactive 3D experience, not the flat hero", () => {
    expect(page).toMatch(/<PropertyTour /);
    expect(page).toMatch(/<JourneySection \/>/);
    expect(page).not.toMatch(/Turn more real-estate enquiries into buyers/);
  });

  it("existing sections below the experience are preserved", () => {
    for (const anchor of ['id="platform"', 'id="workflow"', 'id="capabilities"', 'id="demo"', 'id="portfolio"']) {
      expect(page).toContain(anchor);
    }
    expect(page).toMatch(/<PublicChatWidget \/>/);
  });

  it("dashboard carries the ambient revenue visual without touching sections", () => {
    const dashboard = readFileSync(
      resolve(here, "..", "..", "app", "(dashboard)", "dashboard", "page.tsx"),
      "utf8"
    );
    expect(dashboard).toMatch(/<RevenueTower atRisk=\{revenueRisk\.totalRevenueAtRisk\}/);
    expect(dashboard).toMatch(/<OnboardingChecklist organizationId=\{organizationId\} \/>/);
    expect(dashboard).toMatch(/Conversion funnel|conversion/i);
  });
});
