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

export function detectWebGL(): boolean {
  try {
    if (typeof document === "undefined") return false;
    // Some browsers expose WebGLRenderingContext but block context creation
    // (disabled GPU, privacy mode). Probe real context creation with the same
    // attributes the tour renderer uses, and confirm a basic GL call works.
    const w = window as unknown as { WebGLRenderingContext?: unknown; WebGL2RenderingContext?: unknown };
    if (!w.WebGLRenderingContext && !w.WebGL2RenderingContext) return false;
    const canvas = document.createElement("canvas");
    const attrs: WebGLContextAttributes = {
      antialias: true,
      depth: true,
      stencil: false,
      alpha: false,
      powerPreference: "high-performance",
    };
    const gl =
      (canvas.getContext("webgl2", attrs) as WebGLRenderingContext | null) ??
      (canvas.getContext("webgl", attrs) as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return false;
    try {
      // A no-op GL call that throws on broken/shadow contexts.
      const dbg = gl.getParameter(gl.VERSION);
      if (!dbg) return false;
    } catch {
      return false;
    }
    // Best-effort cleanup of the probe context (WEBGL_lose_context).
    try {
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    } catch {
      // Non-fatal.
    }
    return true;
  } catch {
    return false;
  }
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

/** Cubic ease-in-out for cinematic flights (0..1 → 0..1). */
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

/** Linear interpolation helper for camera vectors. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
