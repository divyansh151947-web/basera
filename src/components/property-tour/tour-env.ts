/**
 * Environment capability helpers (pure, DOM-guarded, unit-tested).
 * Decides quality tier + fallbacks without ever throwing in odd browsers.
 */

export interface TourEnv {
  webgl: boolean;
  reducedMotion: boolean;
  simplified: boolean;
  pixelRatio: number;
  shadows: boolean;
}

/**
 * Context configurations the tour tries, BEST-FIRST.
 *
 * Root-cause fix for the "your device blocked interactive 3D" false
 * negative: requesting `powerPreference: "high-performance"` (and/or
 * antialias) makes context creation FAIL outright on dual-GPU laptops,
 * blocklisted GPUs, VMs and privacy modes — even though plain WebGL works
 * perfectly. The probe and the renderer now walk this ladder, so the tour
 * only ever reports "no WebGL" when WebGL truly cannot start.
 */
export interface GlAttempt {
  antialias: boolean;
  highPerformance: boolean;
}

export const GL_ATTEMPTS: readonly GlAttempt[] = [
  { antialias: true, highPerformance: true },
  { antialias: true, highPerformance: false },
  { antialias: false, highPerformance: false },
];

export interface WebGLProbe {
  ok: boolean;
  /** Index into GL_ATTEMPTS of the configuration that created a context (-1 when none did). */
  attempt: number;
}

/**
 * Probe REAL context creation (not the existence of WebGL classes) by trying
 * each GL_ATTEMPTS entry against webgl2 → webgl → experimental-webgl, then
 * confirming a basic GL call works. Cleans up via WEBGL_lose_context.
 */
export function probeWebGL(): WebGLProbe {
  try {
    if (typeof document === "undefined") return { ok: false, attempt: -1 };
    // Some browsers expose WebGLRenderingContext but block context creation
    // (disabled GPU, privacy mode).
    const w = window as unknown as { WebGLRenderingContext?: unknown; WebGL2RenderingContext?: unknown };
    if (!w.WebGLRenderingContext && !w.WebGL2RenderingContext) return { ok: false, attempt: -1 };
    for (let i = 0; i < GL_ATTEMPTS.length; i += 1) {
      const { antialias, highPerformance } = GL_ATTEMPTS[i];
      const canvas = document.createElement("canvas");
      const attrs: WebGLContextAttributes = {
        antialias,
        depth: true,
        stencil: false,
        alpha: false,
        powerPreference: highPerformance ? "high-performance" : "default",
      };
      const gl =
        (canvas.getContext("webgl2", attrs) as WebGLRenderingContext | null) ??
        (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null) ??
        (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
      if (!gl) continue;
      try {
        // A no-op GL call that throws on broken/shadow contexts.
        const dbg = gl.getParameter(gl.VERSION);
        if (!dbg) continue;
      } catch {
        continue;
      }
      // Best-effort cleanup of the probe context (WEBGL_lose_context).
      try {
        const ext = gl.getExtension("WEBGL_lose_context");
        ext?.loseContext();
      } catch {
        // Non-fatal.
      }
      return { ok: true, attempt: i };
    }
    return { ok: false, attempt: -1 };
  } catch {
    return { ok: false, attempt: -1 };
  }
}

export function detectWebGL(): boolean {
  return probeWebGL().ok;
}

export function prefersReducedMotion(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function isCoarseViewport(width: number): boolean {
  return width < 768;
}

export function resolveTourEnv(viewportWidth: number, devicePixelRatio: number | undefined): TourEnv {
  const webgl = detectWebGL();
  const reducedMotion = prefersReducedMotion();
  // LOW tier: small screens, no WebGL, or weak desktop hardware (few/slow
  // cores) get the simplified scene: fewer trees/towers, no shadows, no
  // secondary lights, no cars. Same rooms/camera/hotspots/AI — only cheaper
  // rendering work. UI is identical across tiers.
  const simplified = isCoarseViewport(viewportWidth) || !webgl || detectLowPowerDevice();
  const pixelRatio = !webgl ? 1 : Math.min(devicePixelRatio || 1, isCoarseViewport(viewportWidth) ? 1.5 : 2);
  return { webgl, reducedMotion, simplified, pixelRatio, shadows: webgl && !isCoarseViewport(viewportWidth) };
}

/**
 * Practical low-power signal — zero benchmark cost, evaluated once per
 * mount. Few CPU cores (integrated-graphics laptops, budget phones) or tiny
 * device memory reliably predict weak GPUs. Unknown/absent APIs → false
 * (full quality), so desktops without these APIs never downgrade.
 */
export function detectLowPowerDevice(): boolean {
  try {
    const nav =
      typeof navigator !== "undefined"
        ? (navigator as Navigator & { deviceMemory?: unknown; hardwareConcurrency?: unknown })
        : undefined;
    if (!nav) return false;
    if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4) return true;
    if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Render stride per tier: HIGH renders every frame; LOW (simplified) renders
 * every 2nd frame with accumulated time deltas, so camera flights, pool,
 * cars, and orbits move at IDENTICAL speed using half the GPU. Callers must
 * leave their clock untouched on skipped frames so deltas accumulate.
 */
export function frameStride(simplified: boolean): number {
  return simplified ? 2 : 1;
}

// ------------------------------------------------------ adaptive quality ---

export type QualityLevel = "high" | "balanced" | "performance";
export type QualityPref = QualityLevel | "auto";

export const QUALITY_PREFS: readonly QualityPref[] = ["auto", "high", "balanced", "performance"];

/**
 * A resolved, APPLIED quality plan. Changing tier swaps these knobs live —
 * the scene, camera and materials are NEVER rebuilt or lost.
 */
export interface QualityPlan {
  level: QualityLevel;
  /** Cap handed to renderer.setPixelRatio. */
  maxPixelRatio: number;
  shadows: boolean;
  /** Shadow map edge for the two shadow-casting suns/spots. */
  shadowMapSize: number;
  /** Rim/fill/pool/pole accent lights (visually nice, GPU-costly). */
  secondaryLights: boolean;
  /** Drifting clouds + moving traffic (continuous GPU + CPU animation). */
  atmosphere: boolean;
  /** PBR transmission (renders the scene an extra time — very costly). */
  glassTransmission: boolean;
  /** Render every Nth frame with accumulated deltas (speed stays identical). */
  stride: 1 | 2;
}

export function isQualityPref(v: unknown): v is QualityPref {
  return v === "auto" || v === "high" || v === "balanced" || v === "performance";
}

/**
 * Resolve the user preference + real capability signals into a concrete
 * level. AUTO is deliberately capability-based (viewport, cores, memory) —
 * never user-agent sniffing — and manual choices are always honored.
 */
export function resolveQualityLevel(
  pref: QualityPref,
  caps: { viewportWidth: number; lowPower: boolean; webgl: boolean }
): QualityLevel {
  if (!caps.webgl) return "performance";
  if (pref !== "auto") return pref;
  if (isCoarseViewport(caps.viewportWidth) || caps.lowPower) return "performance";
  return "high";
}

/**
 * Knobs per level. AUTO already resolved the level before this runs, so this
 * is a pure mapping. Phones keep a slightly higher pixel cap under
 * "performance" than desktops do — their CSS pixels are much smaller.
 */
export function qualityPlan(level: QualityLevel, viewportWidth: number, devicePixelRatio: number | undefined): QualityPlan {
  const dpr = devicePixelRatio || 1;
  const coarse = isCoarseViewport(viewportWidth);
  switch (level) {
    case "high":
      return {
        level,
        maxPixelRatio: Math.min(dpr, 2),
        shadows: true,
        shadowMapSize: 1024,
        secondaryLights: true,
        atmosphere: true,
        glassTransmission: true,
        stride: 1,
      };
    case "balanced":
      return {
        level,
        maxPixelRatio: Math.min(dpr, 1.5),
        shadows: true,
        shadowMapSize: 1024,
        secondaryLights: true,
        atmosphere: true,
        glassTransmission: false,
        stride: 1,
      };
    case "performance":
    default:
      return {
        level: "performance",
        maxPixelRatio: coarse ? Math.min(dpr, 1.5) : 1,
        shadows: false,
        shadowMapSize: 512,
        secondaryLights: false,
        atmosphere: false,
        glassTransmission: false,
        stride: 2,
      };
  }
}

/** Cubic ease-in-out for cinematic flights (0..1 → 0..1). */
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/** Linear interpolation helper for camera vectors. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
