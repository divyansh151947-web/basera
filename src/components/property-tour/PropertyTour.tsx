"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Volume2, VolumeX, Maximize2, Minimize2, Search, Gauge } from "lucide-react";
import type * as THREE from "three";
import { TOUR_AMBIENT_AVAILABLE, TourAmbientSound } from "./tour-ambient";
import {
  CAMERA_PRESETS,
  CINE_INTRO_FROM,
  FLOORS,
  NAV_ORDER,
  HOTSPOTS,
  ROOM_INFO,
  type TourLocationId,
} from "./tour-types";
import { DOOR_DOLLY_MS, FLIGHT_MS, startFlight, stepFlight, type Flight } from "./tour-camera";
import {
  detectLowPowerDevice,
  easeInOutCubic,
  isQualityPref,
  probeWebGL,
  qualityPlan,
  resolveQualityLevel,
  resolveTourEnv,
  type QualityLevel,
  type QualityPref,
  type TourEnv,
} from "./tour-env";
// TYPE-ONLY import from tour-scene. tour-scene is the only module in this
// route that value-imports `three`, so a runtime import here would make the
// whole three.js bundle a *synchronous* dependency of this component: webpack
// would then have to download AND evaluate ~380 KB of three.js before this
// module's own code could run, which blocks the hero heading from painting.
// Perf trace evidence: a 2525 ms `EvaluateScript` of the three.js chunk ran
// before the H1 painted (LCP ~5984 ms). The single floor-slab call site below
// already loads tour-scene with a dynamic `import()`, so nothing is lost.
import type { TourRefs } from "./tour-scene";
import { PropertyIntelligence } from "./PropertyIntelligence";
import { PropertyExplorer } from "./PropertyExplorer";

type Phase = "loading" | "cine" | "door" | "opening" | "tour" | "failed" | "error";
type SceneApi = typeof import("./tour-scene");
type HeadingTag = "h1" | "h2";
/** Honest loading stages — text follows REAL progress, never a fake %. */
type LoadStage = "engine" | "scene" | "lighting";

const LOAD_STAGE_LABEL: Record<LoadStage, string> = {
  engine: "Loading the 3D engine…",
  scene: "Building the villa…",
  lighting: "Lighting golden hour…",
};

const QUALITY_STORAGE_KEY = "basera:tour-quality";

function readQualityPref(): QualityPref {
  try {
    const v = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    return isQualityPref(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

function writeQualityPref(pref: QualityPref): void {
  try {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, pref);
  } catch {
    // Private mode — the choice still applies for this session.
  }
}

/**
 * Start downloading three.js + the scene module the moment THIS chunk is
 * evaluated — not later, when boot() finally runs.
 *
 * Both halves of that timing were measured on a fresh Chrome trace of /tour
 * (390x844, DPR 3, 4x CPU, 1.6 Mbps/150 ms RTT):
 *
 *  - A *static* `import ... from "./tour-scene"` made three.js a synchronous
 *    dependency of this module. Webpack then had to evaluate the whole
 *    three.js bundle (a 2525 ms `EvaluateScript` of a 378 KB chunk) BEFORE
 *    this component's own code could run, so nothing painted until three.js
 *    was parsed, compiled and executed. That is the /tour LCP regression.
 *
 *  - Moving those imports inside boot() fixed the blocking, but boot() only
 *    runs after this chunk has evaluated, hydrated and mounted. The 378 KB
 *    download therefore started ~1.1 s later (measured: +1995 ms -> +3084 ms),
 *    and since the hero heading waits on the scene, LCP got worse, not better.
 *
 * A module-scope `import()` is the best of both: it still creates an async
 * chunk boundary, so nothing here blocks on three.js, but the fetch begins as
 * early as this module is evaluated. The promise is cached, so boot() awaits a
 * download that is already well underway.
 */
const tourEnginePromise: Promise<[SceneApi, typeof import("three")]> = Promise.all([
  import("./tour-scene"),
  import("three"),
]);

const CINE_LEG_MS = [4200, 4800];
/** Mid beat of the opening dolly: approach → architectural reveal → door. */
const CINE_INTRO_MID = {
  pos: { x: 11, y: 3.8, z: 16.5 },
  look: { x: 0.5, y: 2.5, z: -3.5 },
};

const INFO_KEYS = new Set<string>(["exterior", "living", "kitchen", "bedroom", "bathroom", "balcony", "pool", "garden", "parking", "terrace", "rooftop"]);

const HERO_STATS = ["3 BHK villa", "Private pool", "Terrace + garden", "Live 3D"];

// Pre-computed styles to avoid inline style recalculation
const CINEMATIC_GRADE_STYLE = {
  background: "linear-gradient(180deg, rgba(255,170,100,0.10) 0%, rgba(20,26,44,0.06) 45%, rgba(10,12,22,0.22) 100%)",
  mixBlendMode: "soft-light" as const,
};

const VIGNETTE_STYLE = {
  background: "radial-gradient(ellipse at center, transparent 52%, rgba(8,10,18,0.42) 100%)",
};

const GRAIN_STYLE = {
  opacity: 0.05,
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E\")",
};

const GRADIENT_BG_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px), linear-gradient(160deg, #16202f 0%, #101825 55%, #0f1f1a 100%)",
};

const LOADING_BG_STYLE = {
  background: "linear-gradient(180deg,#2b3350_0%,#6b4a3a_55%,#1a2030_100%)",
};

const FALLBACK_POSTER_STYLE = {
  background: "linear-gradient(180deg, rgba(26,32,48,0.25) 0%, rgba(26,32,48,0.55) 55%, rgba(10,12,20,0.92) 100%)",
};

const FALLBACK_GRADE_STYLE = {
  background: "linear-gradient(180deg, rgba(255,170,100,0.12), transparent 50%)",
  mixBlendMode: "soft-light" as const,
};

const FALLBACK_ROOM_BG_STYLE = {
  background: "linear-gradient(180deg, rgba(26,32,48,0.25) 0%, rgba(26,32,48,0.55) 55%, rgba(10,12,20,0.92) 100%)",
};

const FALLBACK_GRADE_STYLE_2 = {
  background: "linear-gradient(180deg, rgba(255,170,100,0.12), transparent 50%)",
  mixBlendMode: "soft-light" as const,
};

const FALLBACK_ROOM_GRADIENT = {
  backgroundImage: "url(\"https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1800&q=80\")",
};

const FALLBACK_ROOM_BG = {
  background: "linear-gradient(180deg, rgba(26,32,48,0.25) 0%, rgba(26,32,48,0.55) 55%, rgba(10,12,20,0.92) 100%)",
};

const FALLBACK_GRADE = {
  background: "linear-gradient(180deg, rgba(255,170,100,0.12), transparent 50%)",
  mixBlendMode: "soft-light" as const,
};

/**
 * Basera cinematic world shell on "/".
 * Same Three.js villa renders the opening dolly ("film") and the realtime
 * tour — one continuous property, one palette, one sun, one grade.
 */
export function PropertyTour({ headingLevel = "h1" }: { headingLevel?: HeadingTag } = {}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const hotspotLayerRef = useRef<HTMLDivElement | null>(null);
  // Progress bar is updated via ref during the 60fps dolly — never via
  // setState per frame (that re-rendered the whole shell every frame).
  const cineBarRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [env, setEnv] = useState<TourEnv | null>(null);
  // Honest loading progress (real boot stages — no fabricated percentage).
  const [loadStage, setLoadStage] = useState<LoadStage>("engine");
  // Adaptive quality: persisted user preference + currently resolved tier.
  const [qualityPref, setQualityPref] = useState<QualityPref>("auto");
  const [qualityLevel, setQualityLevel] = useState<QualityLevel | null>(null);
  // Boot-failure detail (renderer/scene error — NOT "your device blocked
  // WebGL"; that copy is reserved for genuinely WebGL-less browsers).
  const [failDetail, setFailDetail] = useState<string | null>(null);
  const [location, setLocation] = useState<TourLocationId>("door");
  const [floorIndex, setFloorIndex] = useState(0);
  // Same-property cinematic still: captured from the live scene, shown only
  // if the GPU context is lost mid-session (never a generic stock image).
  const [stillUrl, setStillUrl] = useState<string | null>(null);
  // Optional ambient music: intent defaults on (subtle), but nothing plays
  // until a user gesture unlocks it; the toggle appears only once the
  // licensed asset proves loadable (hidden otherwise — no dead control).
  const ambientRef = useRef<TourAmbientSound | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [soundReady, setSoundReady] = useState(false);
  // 3D Focus Mode: hides large UI panels to maximize 3D viewport
  const [isFocusMode, setIsFocusMode] = useState(false);
  const toggleFocusMode = () => setIsFocusMode(prev => !prev);

  // Property Explorer panel
  const [isPropertyExplorerOpen, setIsPropertyExplorerOpen] = useState(false);
  const openPropertyExplorer = () => setIsPropertyExplorerOpen(true);
  const closePropertyExplorer = () => setIsPropertyExplorerOpen(false);
  // Whether the tour canvas is currently on screen (mirrored from the boot
  // visibility observer): gates the ESC-to-exit shortcut on the homepage so
  // ESC never hijacks scrolling elsewhere. On /tour the tour IS the page.
  const inViewRef = useRef(false);
// tour-scene is loaded via dynamic import inside init(); the unmount cleanup
// runs outside that scope, so retain the module for GPU teardown.
const sceneApiRef = useRef<SceneApi | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  // On /tour the canvas fills the viewport from the first paint (including
  // the deferred-boot loading state), so ESC works immediately there. The
  // boot observer corrects this ref on the homepage once running.
  if (pathname === "/tour") inViewRef.current = true;
  const stateRef = useRef({
    phase: "loading" as Phase,
    location: "door" as TourLocationId,
    flight: null as Flight | null,
    doorT: -1,
    cineT: -1,
    cineLeg: 0,
    cineElapsed: 0,
    swayT: 0,
    frames: 0,
    fpsEMA: 60,
    dprStep: 0,
    skipCount: 0,
    renderedFrames: 0,
    lastCensusAt: 0,
    posterTaken: false,
    posterUrl: null as string | null,
    doorBase: null as { pos: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } } | null,
    renderer: null as THREE.WebGLRenderer | null,
    scene: null as THREE.Scene | null,
    camera: null as THREE.PerspectiveCamera | null,
    refs: null as TourRefs | null,
    threeLib: null as typeof import("three") | null,
    cleanup: null as (() => void) | null,
    raf: 0,
    last: 0,
    disposed: false,
    cachedWidth: -1,
    cachedHeight: -1,
    hotspotFrame: 0,
    loadStage: "engine" as LoadStage,
    failDetail: null as string | null,
    qualityPref: "auto" as QualityPref,
    qualityLevel: null as QualityLevel | null,
    preserveDrawingBuffer: true,
    booted: false,
    bootTimer: 0,
    /** World generation — stale RAF loops from a previous world self-stop. */
    gen: 0,
  });

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;
    const mount: HTMLDivElement = mountEl;
    const st = stateRef.current;
    st.disposed = false;
    let cancelled = false;
    // Reused scratch vector for per-frame hotspot projection (see below).
    let hotspotVec: THREE.Vector3 | null = null;
    // Ambient music controller (single Audio instance, preloaded here —
    // playback only starts from a user gesture, see unlock call sites).
    if (!ambientRef.current) {
      ambientRef.current = new TourAmbientSound({
        onReady: () => {
          if (!cancelled) setSoundReady(true);
        },
        onUnsupported: () => {
          if (!cancelled) setSoundReady(false);
        },
      });
    }
    // Preload only when the licensed track is actually present in this build.
    // `TOUR_AMBIENT_AVAILABLE` is resolved at build time (see next.config.mjs),
    // so with the asset absent we skip constructing the <audio> element
    // entirely: no request, no 404, `soundReady` stays false and the sound
    // control stays hidden — the tour runs silently, exactly as
    // public/audio/README.md documents. Drop the file in and rebuild and the
    // whole audio feature enables itself with no code change.
    if (ambientRef.current && TOUR_AMBIENT_AVAILABLE) {
      ambientRef.current.prepare();
    }

    async function init() {
      const gl = probeWebGL();
      const detected = resolveTourEnv(window.innerWidth, window.devicePixelRatio);
      if (cancelled) return;
      setEnv(detected);
      if (!gl.ok) {
        // WebGL genuinely cannot start on this device/configuration — the
        // cinematic stills fallback is the honest, intended experience.
        st.phase = "failed";
        st.failDetail = null;
        setPhase("failed");
        return;
      }
      // Resolve the initial adaptive-quality tier (persisted preference +
      // real capability signals, no user-agent sniffing).
      st.qualityPref = readQualityPref();
      setQualityPref(st.qualityPref);
      const initialLevel = resolveQualityLevel(st.qualityPref, {
        viewportWidth: window.innerWidth,
        lowPower: detectLowPowerDevice(),
        webgl: true,
      });
      st.qualityLevel = initialLevel;
      setQualityLevel(initialLevel);
      try {
        setLoadStage("engine");
        st.loadStage = "engine";
        const [sceneApi, three] = await tourEnginePromise;
        sceneApiRef.current = sceneApi;
        if (cancelled) return;
        setLoadStage("scene");
        st.loadStage = "scene";
        await boot(three, sceneApi, detected, gl.attempt);
      } catch (err) {
        if (!cancelled) {
          // A boot/import/renderer error is NOT "your device blocked WebGL".
          // Show an honest error with a retry that re-initializes in place.
          st.phase = "error";
          st.failDetail = err instanceof Error ? err.message : String(err);
          setFailDetail(st.failDetail);
          setPhase("error");
        }
      }
    }

    async function boot(THREE: typeof import("three"), sceneApi: SceneApi, detected: TourEnv, glAttempt: number) {
      const mountElNow = mountRef.current;
      if (!mountElNow) return;
      // Renderer context ladder: prefer the configuration the probe verified,
      // then progressively relax the requests that commonly fail on
      // dual-GPU laptops / blocklisted GPUs / privacy modes (powerPreference,
      // antialias) before ever giving up. Root-cause fix for the false
      // "device blocked interactive 3D" fallback.
      const baseAA = !detected.simplified;
      const rendererAttempts: Array<THREE.WebGLRendererParameters> = [
        { antialias: baseAA, powerPreference: "high-performance", preserveDrawingBuffer: true },
        { antialias: baseAA, preserveDrawingBuffer: true },
        { antialias: false, preserveDrawingBuffer: true },
        { antialias: false },
      ];
      // Reorder so the probe-verified configuration leads the ladder.
      if (glAttempt > 0 && glAttempt < rendererAttempts.length) {
        const [lead] = rendererAttempts.splice(glAttempt, 1);
        rendererAttempts.unshift(lead);
      }
      let renderer: THREE.WebGLRenderer | null = null;
      for (const params of rendererAttempts) {
        try {
          renderer = new THREE.WebGLRenderer(params);
          st.preserveDrawingBuffer = params.preserveDrawingBuffer !== false;
          break;
        } catch {
          // Try the next, more tolerant configuration.
        }
      }
      if (!renderer) {
        st.phase = "error";
        st.failDetail = "The browser refused every graphics context we can safely request.";
        setFailDetail(st.failDetail);
        setPhase("error");
        return;
      }
      const W = mountElNow.clientWidth || window.innerWidth;
      const H = mountElNow.clientHeight || window.innerHeight;
      renderer.setSize(W, H);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.28;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      // three r186 removed PCFSoftShadowMap (it silently fell back to
      // PCFShadowMap with a console warning) — request PCF directly.
      renderer.shadowMap.type = THREE.PCFShadowMap;
      mountElNow.appendChild(renderer.domElement);
      // Narrowed alias — every closure below renders through this handle.
      const glRenderer: THREE.WebGLRenderer = renderer;
      // Bump the world generation: any RAF loop still queued from a previous
      // world (retry/unmount race) observes the mismatch and stops.
      const gen = ++st.gen;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 500);
      // Build detail follows the resolved quality tier (performance keeps the
      // lean prop counts; the villa architecture itself is identical).
      const buildSimplified = (st.qualityLevel ?? "high") === "performance";
      const refs = sceneApi.createTourWorld(scene, buildSimplified);
      setLoadStage("lighting");
      st.loadStage = "lighting";
      // Soft image-based ambience for PBR glass/metal (best-effort, non-blocking).
      void sceneApi.enhanceWithEnvironment(scene, renderer).catch(() => undefined);

      Object.assign(st, { renderer, scene, camera, refs, threeLib: THREE, last: performance.now() });
      st.booted = true;

      // Apply the resolved quality plan (pixel ratio, shadows, accent lights,
      // glass, atmosphere) to the fresh world — one code path shared with
      // live tier switching.
      let stride: 1 | 2 = 2;
      const applyQualityLive = () => {
        if (!st.renderer || !st.scene || !st.refs) return;
        const lvl = st.qualityLevel ?? "high";
        const plan = qualityPlan(lvl, window.innerWidth, window.devicePixelRatio);
        stride = plan.stride;
        sceneApi.applyLiveQuality(st.scene, st.renderer, st.refs, plan);
        st.dprStep = 0;
        st.cachedWidth = -1;
        st.cachedHeight = -1;
      };
      applyQualityLive();

      if (detected.reducedMotion) {
        applyPreset(camera, CAMERA_PRESETS.door);
        st.doorBase = { pos: { ...CAMERA_PRESETS.door.pos }, look: { ...CAMERA_PRESETS.door.look } };
        st.phase = "door";
        setPhase("door");
      } else {
        // Cinematic opening, two beats, one world:
        // wide establish → approach/reveal → door. Same scene as the tour.
        applyPreset(camera, CINE_INTRO_FROM);
        st.flight = { from: CINE_INTRO_FROM, to: CINE_INTRO_MID, durationMs: CINE_LEG_MS[0], elapsedMs: 0, arcHeight: 0.7, done: false };
        st.cineLeg = 0;
        st.cineElapsed = 0;
        st.cineT = 0;
        st.phase = "cine";
        setPhase("cine");
      }

      const onResize = () => {
        const el = mountRef.current;
        if (!el) return;
        const w = el.clientWidth || window.innerWidth;
        const h = el.clientHeight || window.innerHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        glRenderer.setSize(w, h);
        // Invalidate cached dimensions so hotspots recalculate on next update
        st.cachedWidth = -1;
        st.cachedHeight = -1;
      };
      window.addEventListener("resize", onResize);

      let visible = true;
      let sectionVisible = true;
      const observer = new IntersectionObserver((entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        sectionVisible = visible;
        inViewRef.current = visible;
        ambientRef.current?.setSceneVisible(sectionVisible && document.visibilityState === "visible");
      });
      observer.observe(mountElNow);
      const onVisibility = () => {
        visible = document.visibilityState === "visible";
        inViewRef.current = sectionVisible && document.visibilityState === "visible";
        ambientRef.current?.setSceneVisible(sectionVisible && document.visibilityState === "visible");
      };
      document.addEventListener("visibilitychange", onVisibility);

      // Click-the-door raycast (door meshes + porch zone).
      const ray = new THREE.Raycaster();
      const ptr = new THREE.Vector2();
      const onTap = (e: PointerEvent) => {
        if (st.phase !== "door" || !st.camera || !st.refs) return;
        const rect = glRenderer.domElement.getBoundingClientRect();
        ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        ray.setFromCamera(ptr, st.camera);
        const targets: THREE.Object3D[] = [];
        st.refs.doorLeft.traverse((o) => targets.push(o));
        st.refs.doorRight.traverse((o) => targets.push(o));
        targets.push(st.refs.porchZone);
        const hits = ray.intersectObjects(targets, false);
        if (hits.length > 0) openDoor(detected);
      };
      glRenderer.domElement.addEventListener("pointerdown", onTap);

      // GPU context loss: freeze on the same-property cinematic still
      // captured from this exact scene (never a text fallback, never stock).
      // If the browser restores the context later, re-initialize in place —
      // no reload, no duplicate renderers.
      const onContextLost = (e: Event) => {
        e.preventDefault();
        if (st.posterUrl && !cancelled) {
          setStillUrl(st.posterUrl);
        } else if (!cancelled) {
          st.phase = "error";
          st.failDetail = "The graphics context was lost.";
          setFailDetail(st.failDetail);
          setPhase("error");
        }
      };
      const onContextRestored = () => {
        if (!cancelled) retry3D();
      };
      glRenderer.domElement.addEventListener("webglcontextlost", onContextLost);
      glRenderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

      // Live perf census for the quality governor + diagnostics. The scene
      // cost snapshot is taken once (stats), the runtime metrics refresh
      // about once a second while rendering.
      let perfCensus: object | null = null;
      const loop = (now: number) => {
        if (st.disposed || st.gen !== gen) return;
        st.raf = requestAnimationFrame(loop);
        if (!visible || document.visibilityState !== "visible") {
          st.last = now;
          return;
        }
        // Performance-tier pacing: render every Nth frame with accumulated
        // time, so flights/pool/cars/orbit move at IDENTICAL speed for ~1/N
        // the GPU. `stride` follows the live quality tier.
        if (stride > 1) {
          st.skipCount = (st.skipCount + 1) % stride;
          // st.last deliberately untouched on skipped frames → the next
          // rendered frame's delta covers the whole span.
          if (st.skipCount !== 0) return;
        }
        const delta = Math.min(100, now - st.last);
        st.last = now;
        tick(delta, now);
        glRenderer.render(scene, camera);
        st.renderedFrames += 1;
        // Capture one full-res cinematic still of THIS property for the
        // context-loss fallback (preserveDrawingBuffer makes this exact).
        if (!st.posterTaken && st.preserveDrawingBuffer && st.renderedFrames > 10 && (st.phase === "door" || st.phase === "tour")) {
          st.posterTaken = true;
          try {
            st.posterUrl = glRenderer.domElement.toDataURL("image/jpeg", 0.85);
          } catch {
            st.posterUrl = null;
          }
        }
        // One-time perf census for profiling (draw calls, tris, textures),
        // refreshed ~1×/s so fps/quality stay current in diagnostics.
        if (st.renderedFrames === 30 && typeof window !== "undefined") {
          try {
            perfCensus = sceneApi.collectPerfStats(scene, glRenderer);
          } catch {
            perfCensus = null;
          }
        }
        if (perfCensus && now - st.lastCensusAt > 1000) {
          st.lastCensusAt = now;
          try {
            (window as unknown as { __baseraPerf?: object }).__baseraPerf = {
              ...perfCensus,
              fpsEMA: Math.round(st.fpsEMA),
              pixelRatio: glRenderer.getPixelRatio(),
              quality: st.qualityLevel ?? "high",
              qualityPref: st.qualityPref,
              simplified: (st.qualityLevel ?? "high") === "performance",
            };
          } catch {
            // Profiling must never break the tour.
          }
        }
        updateHotspots(camera);
      };
      st.raf = requestAnimationFrame(loop);

      function tick(deltaMs: number, nowMs: number) {
        governPixelRatio(deltaMs);
        // Cinematic intro: chained beats, overall progress for the bar.
        if (st.phase === "cine" && st.flight && !st.flight.done) {
          const step = stepFlight(st.flight, deltaMs);
          st.cineElapsed += deltaMs;
          applyPreset(camera, { pos: step.pos, look: step.look });
          const total = CINE_LEG_MS[0] + CINE_LEG_MS[1];
          if (cineBarRef.current) {
            cineBarRef.current.style.width = `${Math.min(100, Math.round((st.cineElapsed / total) * 100))}%`;
          }
          if (step.done) {
            if (st.cineLeg === 0) {
              // Beat two: reveal → door, chained from the exact end of beat one.
              st.cineLeg = 1;
              st.flight = {
                from: CINE_INTRO_MID,
                to: CAMERA_PRESETS.door,
                durationMs: CINE_LEG_MS[1],
                elapsedMs: 0,
                arcHeight: 0.5,
                done: false,
              };
            } else {
              st.flight = null;
              st.doorBase = { pos: { ...CAMERA_PRESETS.door.pos }, look: { ...CAMERA_PRESETS.door.look } };
              st.phase = "door";
              setPhase("door");
            }
          }
          // Ambient life continues under the dolly.
          ambient(deltaMs, nowMs);
          return;
        }
        // Gentle filmic breathing while waiting at the door (no flight active).
        if (st.phase === "door" && !st.flight && !detected.reducedMotion && st.doorBase) {
          st.swayT += deltaMs / 1000;
          const b = st.doorBase;
          camera.position.set(
            b.pos.x + Math.sin(st.swayT * 1.4) * 0.045,
            b.pos.y + Math.sin(st.swayT * 0.9 + 1.2) * 0.03,
            b.pos.z
          );
          camera.lookAt(b.look.x, b.look.y, b.look.z);
        }
        // Door sequence.
        if (st.doorT >= 0 && !detected.reducedMotion) {
          st.doorT += deltaMs;
          animateDoor(st, st.doorT, refs);
          if (st.doorT >= DOOR_DOLLY_MS + 400) {
            st.doorT = -1;
            arrive("entrance");
          }
        }
        // Camera flights.
        if (st.flight && !st.flight.done) {
          const step = stepFlight(st.flight, deltaMs);
          applyPreset(camera, { pos: step.pos, look: step.look });
          if (step.done) st.flight = null;
        }
        ambient(deltaMs, nowMs);
        pulseAccents(nowMs);
      }

      function ambient(deltaMs: number, nowMs: number) {
        const dt = deltaMs / 1000;
        // Ambient motion follows the live quality tier (Performance keeps
        // the pool still and the sky/traffic frozen — pure GPU/CPU savings).
        const lively = (st.qualityLevel ?? "high") !== "performance";
        if (lively && refs.poolWater) {
          refs.poolWater.position.y = 0.36 + Math.sin((nowMs / 1000) * 1.4) * 0.012;
        }
        if (lively && !detected.reducedMotion) {
          for (const c of refs.clouds) {
            c.position.x += dt * 0.35;
            if (c.position.x > 80) c.position.x = -80;
          }
          for (let i = 0; i < refs.movingCars.length; i += 1) {
            const car = refs.movingCars[i];
            const dir = i % 2 === 0 ? 1 : -1;
            car.position.x += dir * dt * (6 + i * 1.5);
            if (car.position.x > 72) car.position.x = -72;
            if (car.position.x < -72) car.position.x = 72;
          }
        }
      }

      function pulseAccents(nowMs: number) {
        const list = refs.roomAccents?.[st.location];
        if (!list) return;
        const glow = 1.0 + Math.sin(nowMs / 650) * 0.18;
        for (const m of list) {
          try {
            m.emissiveIntensity = glow;
          } catch {
            // Material without emissive.
          }
        }
      }

      // Adaptive DPR: if the device can't hold ~40fps at its quality cap,
      // step pixel ratio down (never up) to protect smoothness. The cap
      // itself comes from the live quality tier.
      function governPixelRatio(deltaMs: number) {
        if (st.disposed) return;
        const fps = 1000 / Math.max(1, deltaMs);
        st.fpsEMA += (fps - st.fpsEMA) * 0.04;
        st.frames += 1;
        if (st.frames % 240 === 0 && st.fpsEMA < 40 && st.dprStep < 3 && st.renderer) {
          st.dprStep += 1;
          const cap = qualityPlan(st.qualityLevel ?? "high", window.innerWidth, window.devicePixelRatio).maxPixelRatio;
          st.renderer.setPixelRatio(Math.max(1, cap - st.dprStep * 0.25));
        }
      }

      function arrive(id: TourLocationId) {
        st.location = id;
        setLocation(id);
        // Entering a room is a natural moment to have music; unlock() is a
        // silent no-op when blocked or already playing.
        if (id === "entrance") void ambientRef.current?.unlock();
      }

      // Live quality hook — the outer retry/quality controller reaches the
      // running world through these without recreating anything.
      (st as unknown as { applyQuality?: () => void }).applyQuality = applyQualityLive;
      (st as unknown as { api: object }).api = {
        openDoor: () => openDoor(detected),
        flyTo: (id: TourLocationId) => flyTo(id, detected),
        skipCine: () => skipCine(),
        arrive,
      };

      st.cleanup = () => {
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVisibility);
        glRenderer.domElement.removeEventListener("pointerdown", onTap);
        glRenderer.domElement.removeEventListener("webglcontextlost", onContextLost);
        glRenderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
        observer.disconnect();
      };
    }

    /**
     * In-place retry: tear down whatever world exists (renderer, scene,
     * listeners, RAF) and boot a fresh one. Never a second renderer, never a
     * page reload — the Retry buttons and context-restore path both use this.
     */
    function retry3D() {
      if (cancelled) return;
      st.disposed = true;
      st.gen += 1; // any still-queued RAF frame self-stops
      cancelAnimationFrame(st.raf);
      st.raf = 0;
      st.cleanup?.();
      st.cleanup = null;
      if (st.scene && st.renderer) {
        try {
          sceneApiRef.current?.disposeTourWorld(st.scene, st.renderer);
        } catch {
          // Best-effort GPU teardown.
        }
        st.scene = null;
      }
      if (st.renderer) {
        try {
          st.renderer.dispose();
        } catch {
          // Best-effort.
        }
        try {
          st.renderer.domElement.parentElement?.removeChild(st.renderer.domElement);
        } catch {
          // Already removed.
        }
        st.renderer = null;
      }
      // Reset the session state machine for a fresh boot.
      st.disposed = false;
      st.booted = false;
      st.phase = "loading";
      st.flight = null;
      st.doorT = -1;
      st.cineT = -1;
      st.cineLeg = 0;
      st.cineElapsed = 0;
      st.frames = 0;
      st.renderedFrames = 0;
      st.skipCount = 0;
      st.dprStep = 0;
      st.posterTaken = false;
      st.posterUrl = null;
      st.doorBase = null;
      st.refs = null;
      st.camera = null;
      st.scene = null;
      st.threeLib = null;
      st.cachedWidth = -1;
      st.cachedHeight = -1;
      setStillUrl(null);
      setFailDetail(null);
      st.failDetail = null;
      setLoadStage("engine");
      st.loadStage = "engine";
      setPhase("loading");
      // The mount div only re-enters the DOM once phase returns to a world
      // phase — wait one frame so React commits it before boot reads it.
      requestAnimationFrame(() => {
        if (!cancelled) void init();
      });
    }

    function setQualityPrefLive(pref: QualityPref) {
      st.qualityPref = pref;
      writeQualityPref(pref);
      const level = resolveQualityLevel(pref, {
        viewportWidth: window.innerWidth,
        lowPower: detectLowPowerDevice(),
        webgl: true,
      });
      st.qualityLevel = level;
      setQualityPref(pref);
      setQualityLevel(level);
      // Apply to the live world if one exists; boot applies it otherwise.
      (st as unknown as { applyQuality?: () => void }).applyQuality?.();
    }

    // Expose retry + quality control to the UI layer (works even when boot
    // failed before the world API existed).
    (st as unknown as { retry?: () => void }).retry = retry3D;
    (st as unknown as { setQualityPref?: (p: QualityPref) => void }).setQualityPref = setQualityPrefLive;

    function applyPreset(camera: THREE.PerspectiveCamera, preset: { pos: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } }) {
      camera.position.set(preset.pos.x, preset.pos.y, preset.pos.z);
      camera.lookAt(preset.look.x, preset.look.y, preset.look.z);
    }

    function skipCine() {
      if (st.phase !== "cine" || !st.camera) return;
      st.flight = null;
      applyPreset(st.camera, CAMERA_PRESETS.door);
      st.doorBase = { pos: { ...CAMERA_PRESETS.door.pos }, look: { ...CAMERA_PRESETS.door.look } };
      st.phase = "door";
      setPhase("door");
    }

    function openDoor(detected: TourEnv) {
      if (st.phase !== "door" || !st.camera) return;
      // Door click is a user gesture: allowed moment to start ambient music.
      void ambientRef.current?.unlock();
      if (detected.reducedMotion) {
        st.refs!.doorLeft.rotation.y = 1.85;
        st.refs!.doorRight.rotation.y = -1.85;
        for (const glow of st.refs!.entryGlow) glow.material.opacity = 0.55;
        st.refs!.interiorSpot.intensity = 80;
        applyPreset(st.camera, CAMERA_PRESETS.entrance);
        st.phase = "tour";
        setPhase("tour");
        st.location = "entrance";
        setLocation("entrance");
        return;
      }
      st.phase = "opening";
      setPhase("opening");
      st.doorT = 0;
      const dolly = startFlight(CAMERA_PRESETS.door, "entrance", DOOR_DOLLY_MS);
      dolly.elapsedMs = -500;
      st.flight = dolly;
    }

    function flyTo(id: TourLocationId, detected: TourEnv) {
      if (!st.camera || st.phase === "loading" || st.phase === "failed" || st.phase === "error" || st.phase === "cine") return;
      if (st.phase === "door" || st.phase === "opening") {
        st.doorT = -1;
        st.refs!.doorLeft.rotation.y = 1.85;
        st.refs!.doorRight.rotation.y = -1.85;
        for (const glow of st.refs!.entryGlow) glow.material.opacity = 0.55;
        st.refs!.interiorSpot.intensity = 80;
        st.phase = "tour";
        setPhase("tour");
      }
      const from = {
        pos: { x: st.camera.position.x, y: st.camera.position.y, z: st.camera.position.z },
        look: currentLook(st),
      };
      st.flight = startFlight(from, id, detected.reducedMotion ? 0 : FLIGHT_MS);
      st.location = id;
      setLocation(id);
    }

    function currentLook(s: typeof st) {
      if (s.flight && !s.flight.done) return { ...s.flight.to.look };
      return { ...CAMERA_PRESETS[s.location].look };
    }

    function updateHotspots(camera: THREE.PerspectiveCamera) {
      const layer = hotspotLayerRef.current;
      const host = mountRef.current;
      if (!layer || !st.refs || !host || !st.threeLib) return;

      // Cache viewport dimensions — re-read ONLY when invalidated (resize /
      // quality change set these to -1). The previous `0 ?? x` pattern never
      // re-read because the cache initializes to 0, which is not nullish —
      // every hotspot projected with w=h=0 and stacked at the corner.
      if (st.cachedWidth < 0) {
        st.cachedWidth = host.clientWidth || window.innerWidth;
        st.cachedHeight = host.clientHeight || window.innerHeight;
      }
      const w = st.cachedWidth;
      const h = st.cachedHeight;
      
      // Throttle hotspot updates - only run every 3 frames (~20fps) since camera moves smoothly
      st.hotspotFrame = (st.hotspotFrame ?? 0) + 1;
      if (st.hotspotFrame % 3 !== 0) return;
      
      // Reused temp vector: avoids one Vector3 allocation per hotspot per frame
      hotspotVec ??= new st.threeLib.Vector3();
      const children = layer.children;
      
      for (let i = 0; i < HOTSPOTS.length; i += 1) {
        const el = children[i] as HTMLElement | undefined;
        if (!el) continue;
        const hs = HOTSPOTS[i];
        const shouldShow = hs.visibleFrom.includes(st.location) && (st.phase === "tour" || st.phase === "opening");
        if (!shouldShow) {
          if (el.style.display !== "none") {
            el.style.display = "none";
            el.style.opacity = "0";
            el.style.pointerEvents = "none";
          }
          continue;
        }
        const v = hotspotVec.set(hs.anchor.x, hs.anchor.y, hs.anchor.z).project(camera);
        if (v.z > 1 || v.z < -1) {
          if (el.style.display !== "none") {
            el.style.display = "none";
            el.style.opacity = "0";
            el.style.pointerEvents = "none";
          }
          continue;
        }
        // Use transform instead of left/top for better performance (GPU accelerated)
        const x = ((v.x + 1) / 2) * w;
        const y = ((-v.y + 1) / 2) * h;
        if (el.style.display !== "flex") {
          el.style.display = "flex";
          el.style.pointerEvents = "auto";
        }
        el.style.opacity = "1";
        el.style.transform = `translate(${x}px, ${y}px)`;
        // Clear left/top if they were set
        if (el.style.left) el.style.left = "";
        if (el.style.top) el.style.top = "";
      }
    }

    // Perf: on the homepage this canvas sits below the fold, so defer the
    // scene build until the section is near the viewport. TWO safety nets
    // guarantee boot always happens (root-cause fix for the infinite
    // "Lighting the villa…" hang):
    //  - IntersectionObserver callbacks are deferred indefinitely for hidden
    //    or occluded windows, so a fixed timeout also boots the experience;
    //  - a visibilitychange handler re-arms a short timer when the tab
    //    becomes visible.
    // On /tour the experience IS the page — boot immediately, no gate.
    let gate: IntersectionObserver | null = null;
    let bootedOnce = false;
    let visibleBootTimer = 0;
    const requestBoot = () => {
      if (bootedOnce || cancelled) return;
      bootedOnce = true;
      window.clearTimeout(st.bootTimer);
      void init();
    };
    const armVisibleBoot = () => {
      if (bootedOnce || cancelled || document.visibilityState !== "visible") return;
      window.clearTimeout(visibleBootTimer);
      visibleBootTimer = window.setTimeout(requestBoot, 1500);
    };
    const onGateVisibility = () => {
      if (document.visibilityState === "visible") armVisibleBoot();
    };
    if (window.location.pathname === "/tour" || typeof IntersectionObserver !== "function") {
      requestBoot();
    } else {
      gate = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            gate?.disconnect();
            gate = null;
            requestBoot();
          }
        },
        { rootMargin: "1200px 0px" }
      );
      gate.observe(mount);
      st.bootTimer = window.setTimeout(requestBoot, 4000);
      document.addEventListener("visibilitychange", onGateVisibility);
      armVisibleBoot();
    }
    return () => {
      cancelled = true;
      st.disposed = true;
      st.gen += 1; // stale RAF loops self-stop on the generation mismatch
      window.clearTimeout(st.bootTimer);
      window.clearTimeout(visibleBootTimer);
      document.removeEventListener("visibilitychange", onGateVisibility);
      gate?.disconnect();
      ambientRef.current?.dispose();
      ambientRef.current = null;
      cancelAnimationFrame(st.raf);
      st.cleanup?.();
      if (st.scene && st.renderer) {
        try {
          sceneApiRef.current?.disposeTourWorld(st.scene, st.renderer);
        } catch {
          // Best effort GPU teardown.
        }
        st.scene = null;
      }
      st.renderer?.dispose();
      const el = st.renderer?.domElement;
      if (el && el.parentElement) {
        try {
          el.parentElement.removeChild(el);
        } catch {
          // Already removed.
        }
      }
      st.renderer = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function animateDoor(
    st: { refs: TourRefs | null },
    tMs: number,
    refs: TourRefs
  ) {
    void st;
    const handleT = easeInOutCubic(Math.min(1, tMs / 500));
    refs.handleLeft.rotation.x = handleT * 0.5;
    const swingT = easeInOutCubic(Math.min(1, Math.max(0, (tMs - 300) / 1700)));
    refs.doorLeft.rotation.y = swingT * 1.85;
    refs.doorRight.rotation.y = -swingT * 1.85;
    const glowT = easeInOutCubic(Math.min(1, Math.max(0, (tMs - 500) / 1500)));
    for (const glow of refs.entryGlow) glow.material.opacity = Math.max(glow.material.opacity, glowT * 0.55);
    refs.interiorSpot.intensity = 60 + glowT * 20;
  }

  function api() {
    return (stateRef.current as unknown as { api?: { openDoor: () => void; flyTo: (id: TourLocationId) => void; skipCine: () => void } }).api;
  }

  /** In-place 3D retry — re-initializes the world, never reloads the page. */
  function retry3D() {
    (stateRef.current as unknown as { retry?: () => void }).retry?.();
  }

  /** Adaptive quality: cycle Auto → High → Balanced → Performance. */
  function cycleQuality() {
    const order: QualityPref[] = ["auto", "high", "balanced", "performance"];
    const next = order[(order.indexOf(qualityPref) + 1) % order.length];
    (stateRef.current as unknown as { setQualityPref?: (p: QualityPref) => void }).setQualityPref?.(next);
  }

  // Ambient music toggle (click = user gesture, so enabling may unlock audio).
  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    ambientRef.current?.setEnabled(next);
  }

  /**
   * Exit the 3D experience back to the normal website — no reload, no new
   * page architecture. On /tour this client-navigates home (unmount runs the
   * full 3D + audio teardown). On the homepage it smooth-scrolls to the hero,
   * which slides the canvas off-screen so the existing IntersectionObserver
   * pauses rendering AND ambient audio automatically. Music is faded out
   * immediately in both cases.
   */
  function exitTour(fromButton = false) {
    // An explicit Back-button click always acts (the button is only clickable
    // while visible anyway). The ESC shortcut additionally requires the tour
    // to be on screen on the homepage, so ESC never hijacks scrolling
    // elsewhere; on /tour the experience IS the page, so ESC always exits.
    if (!fromButton && pathname !== "/tour" && !inViewRef.current) return;
    ambientRef.current?.setEnabled(false);
    setSoundOn(false);
    if (pathname === "/tour") {
      router.push("/");
      return;
    }
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
  }

  // ESC exits the 3D experience on desktop (mobile has the visible Back
  // control instead). Stable-ref pattern so no listener is ever duplicated
  // across re-renders; exactly one keydown listener per mount.
  const exitRef = useRef(exitTour);
  exitRef.current = exitTour;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const Heading = headingLevel;

  if (phase === "failed") {
    return <TourCinematicFallback headingLevel={headingLevel} onRetry={retry3D} />;
  }

  const infoKey = INFO_KEYS.has(location) ? (location as keyof typeof ROOM_INFO) : null;
  const inTour = phase === "tour" || phase === "opening";
  const letterboxed = phase === "cine" || phase === "opening";

  return (
    <div
      className="relative h-[100svh] w-full overflow-hidden bg-[#1a2030] text-white"
      onPointerDown={() => {
        // Any tap on the experience is a user gesture: start ambient music
        // if permitted (silent no-op when blocked, missing, or playing).
        void ambientRef.current?.unlock();
      }}
    >
      <div ref={mountRef} className="absolute inset-0" />
      {/* Cinematic grade: warm overlay + vignette + grain (same grade for film + realtime). */}
      <div className="pointer-events-none absolute inset-0" style={CINEMATIC_GRADE_STYLE} />
      <div className="pointer-events-none absolute inset-0" style={VIGNETTE_STYLE} />
      <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={GRAIN_STYLE} />
      {/* Letterbox for film continuity. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-black transition-all duration-700" style={{ height: letterboxed ? "7vh" : "0vh" }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black transition-all duration-700" style={{ height: letterboxed ? "7vh" : "0vh" }} />

      <div ref={hotspotLayerRef} className="pointer-events-none absolute inset-0">
        {HOTSPOTS.map((hs) => (
          <button
            key={hs.id}
            type="button"
            data-hotspot-name={hs.id}
            onClick={() => api()?.flyTo(hs.target)}
            className="pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-white/25 bg-black/45 py-1.5 pl-2 pr-3 text-xs font-medium tracking-wide text-white backdrop-blur-sm transition-all duration-300 hover:border-white/60 hover:bg-black/60"
            style={{ display: "none", opacity: 0 }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#ffca7a]" />
            {hs.label}
          </button>
        ))}
      </div>

      {/* Brand crown. On phones it is pushed below the Back control (top-left)
          and slightly reduced so it never collides with it or the top-right
          icon buttons; the mobile room chips (below) start under it. Desktop
          is unchanged. */}
      <div className="pointer-events-none absolute left-1/2 top-14 w-full max-w-[15rem] -translate-x-1/2 text-center sm:top-6 sm:max-w-none">
        <p className="font-display text-2xl tracking-[0.3em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)] sm:text-3xl sm:tracking-[0.35em]">BASERA</p>
        <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.3em] text-white/70">
          Aurum Villa · Golden hour · Live 3D
        </p>
      </div>

      {/* Exit — always visible while inside the experience (desktop, mobile,
          touch, keyboard-focusable). Top-left stays clear of hotspots, the
          nav rail (right), and the command bar (bottom-center). */}
      <button
        type="button"
        onClick={() => exitTour(true)}
        aria-label="Back to Basera website"
        title="Back to Basera (ESC)"
        className="absolute left-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 py-2 pl-2.5 pr-3.5 text-xs font-semibold text-white/85 backdrop-blur-sm transition hover:border-white/50 hover:text-white"
      >
        <ArrowLeft size={14} />
        Back to Basera
      </button>

      {/* Ambient sound toggle — small, top-right, clear of all other UI.
          Rendered only once the licensed asset proves loadable. */}
      {soundReady && !stillUrl && (
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={soundOn}
          aria-label={soundOn ? "Mute ambient music" : "Play ambient music"}
          title={soundOn ? "Sound On — mute ambient music" : "Sound Off — play ambient music"}
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white/80 backdrop-blur-sm transition hover:border-white/50 hover:text-white"
        >
          {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
      )}

      {/* Property Explorer toggle — top-right, below focus mode when visible. */}
      {inTour && !stillUrl && (
        <button
          type="button"
          onClick={openPropertyExplorer}
          aria-label="Explore available properties"
          title="Explore Properties"
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white/80 backdrop-blur-sm transition hover:border-white/50 hover:text-white"
          style={{ top: soundReady ? (inTour ? "108px" : "56px") : "4px" }}
        >
          <Search size={16} />
        </button>
      )}

      {/* 3D Focus Mode toggle — top-right, below sound toggle when visible. */}
      {inTour && !stillUrl && (
        <button
          type="button"
          onClick={toggleFocusMode}
          aria-pressed={isFocusMode}
          aria-label={isFocusMode ? "Show property controls" : "Enter 3D Focus Mode"}
          title={isFocusMode ? "Show property controls" : "Enter 3D Focus Mode"}
          className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white/80 backdrop-blur-sm transition hover:border-white/50 hover:text-white"
          style={{ top: soundReady ? "56px" : "4px" }}
        >
          {isFocusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      )}

      {/* Adaptive quality control — cycles Auto → High → Balanced →
          Performance. Applies live to the running world (pixel ratio,
          shadows, accent lights, glass, atmosphere); never rebuilds the
          scene and never loses camera state. Auto is capability-based. */}
      {inTour && !stillUrl && (
        <button
          type="button"
          onClick={cycleQuality}
          aria-label={`Graphics quality: ${qualityPref}${qualityLevel ? ` (currently ${qualityLevel})` : ""}. Click to change.`}
          title={`Graphics quality: ${qualityPref}${qualityLevel ? ` — running ${qualityLevel}` : ""}`}
          className="absolute right-4 z-20 flex items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80 backdrop-blur-sm transition hover:border-white/50 hover:text-white"
          style={{ top: soundReady ? "160px" : "108px" }}
        >
          <Gauge size={13} />
          {qualityPref}
        </button>
      )}

      {/* Cinematic intro overlay — same scene, film language. On phones the
          block is lifted above the floating chat/voice band (which occupies
          the bottom ~84px) so the progress bar and Skip/Enter actions are not
          covered or pushed below the fold. Desktop unchanged. */}
      {phase === "cine" && (
        <div className="absolute inset-x-0 bottom-28 flex flex-col items-center gap-3 px-4 text-center md:bottom-[9vh]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#ffdf9e]">A cinematic property film — rendered live</p>
          <Heading className="font-display text-3xl text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.6)] md:text-4xl">Aurum Villa, arriving at golden hour</Heading>
          <p className="max-w-md text-xs leading-6 text-white/70">Wide establishing shot → slow approach → architectural reveal → entrance. The film and the 3D tour are the same world.</p>
          <div className="h-[3px] w-56 overflow-hidden rounded-full bg-white/15">
            <div ref={cineBarRef} className="h-full rounded-full bg-[#ffdf9e]" style={{ width: "0%" }} />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => api()?.skipCine()} className="rounded-full border border-white/30 bg-black/50 px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-white backdrop-blur-sm transition hover:border-white/70">
              Skip intro
            </button>
            <button type="button" onClick={() => api()?.skipCine()} className="rounded-full bg-white px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-black transition hover:bg-white/85">
              Enter property
            </button>
          </div>
        </div>
      )}

      {/* Door hero overlay — reference composition: property right, brand
          message left, stats bottom, ENTER center-bottom, nav right. */}
      {phase === "door" && !stillUrl && (
        <>
          <div className="pointer-events-none absolute left-6 top-[30%] hidden max-w-sm md:block lg:left-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#ffdf9e]">Aurum Villa · Live 3D film</p>
            <Heading className="mt-3 font-display text-4xl leading-[1.05] text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.6)] lg:text-5xl">
              Golden-hour modern living.
            </Heading>
            <p className="mt-3 max-w-xs text-sm leading-7 text-white/70">
              Teak, stone and glass — explore every room, then let Basera AI qualify you.
            </p>
          </div>
          <div className="absolute inset-x-0 bottom-24 flex flex-col items-center gap-3 px-4 text-center md:bottom-20">
            <button
              type="button"
              onClick={() => api()?.openDoor()}
              className="rounded-full border border-[#d8a94e]/60 bg-black/55 px-10 py-3.5 text-sm font-semibold uppercase tracking-[0.25em] text-[#ffdf9e] backdrop-blur-sm transition hover:border-[#ffdf9e] hover:bg-black/70"
            >
              Enter Property
            </button>
            <p className="text-[11px] uppercase tracking-[0.2em] text-white/50">Click the door, or press enter</p>
          </div>
          <div className="pointer-events-none absolute bottom-24 left-6 hidden gap-2 lg:flex">
            {HERO_STATS.map((s) => (
              <span key={s} className="rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[11px] font-medium text-white/75 backdrop-blur-sm">
                {s}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Same-property still if the GPU context drops mid-session. */}
      {stillUrl && (
        <div className="absolute inset-0 z-10">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${stillUrl}')` }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(10,12,20,0.25), rgba(10,12,20,0.65))" }} />
          <div className="absolute inset-x-0 bottom-16 flex flex-col items-center gap-3 px-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#ffdf9e]">Live 3D paused — cinematic still</p>
            <p className="max-w-md text-sm text-white/75">Your device paused graphics. This is the same villa, same frame.</p>
            <button type="button" onClick={retry3D} className="rounded-full bg-white px-8 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-black transition hover:bg-white/85">
              Resume 3D tour
            </button>
          </div>
        </div>
      )}

      {phase === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={LOADING_BG_STYLE}>
          <p className="font-display text-3xl tracking-[0.35em] text-white">BASERA</p>
          <p className="text-[11px] uppercase tracking-[0.25em] text-white/60">{LOAD_STAGE_LABEL[loadStage]}</p>
          <div className="h-px w-40 overflow-hidden bg-white/15">
            <div className="h-full w-1/3 animate-pulse bg-[#ffdf9e]" />
          </div>
          <p className="text-[11px] text-white/50">Golden-hour architectural environment</p>
        </div>
      )}

      {/* Honest boot-error state — a real error (import/renderer/scene),
          NOT "your device blocked WebGL". Retry re-initializes in place. */}
      {phase === "error" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 px-6 text-center" style={LOADING_BG_STYLE}>
          <p className="font-display text-3xl tracking-[0.35em] text-white">BASERA</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#ffdf9e]">The 3D tour hit a snag</p>
          <p className="max-w-md text-sm leading-6 text-white/75">
            The interactive scene could not start this time. This is usually temporary — retrying re-initializes the
            villa right here, without reloading the page.
          </p>
          {failDetail && (
            <p className="max-w-md rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] leading-4 text-white/50">
              {failDetail}
            </p>
          )}
          <button
            type="button"
            onClick={retry3D}
            className="rounded-full bg-white px-8 py-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-black transition hover:bg-white/85"
          >
            Retry 3D tour
          </button>
        </div>
      )}

      {/* Room nav rail (desktop) — available from the hero, no reload. */}
      {(inTour || phase === "door") && (
        <div className="absolute right-4 top-1/2 hidden max-h-[70vh] -translate-y-1/2 flex-col gap-0.5 overflow-y-auto pr-1 md:flex">
          <p className="mb-2 px-2 text-right text-[10px] font-semibold uppercase tracking-[0.25em] text-white/50">Explore</p>
          {NAV_ORDER.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => api()?.flyTo(item.id)}
              className={`flex items-center justify-end gap-3 rounded-xl px-2 py-1.5 text-right text-sm transition ${
                location === item.id ? "text-[#ffdf9e]" : "text-white/60 hover:text-white"
              }`}
            >
              {item.label}
              <span className="text-[10px] tracking-[0.2em] text-white/55">{item.index}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => api()?.flyTo("tower")}
            className={`flex items-center justify-end gap-3 rounded-xl px-2 py-1.5 text-right text-sm transition ${
              location === "tower" ? "text-[#ffdf9e]" : "text-white/60 hover:text-white"
            }`}
          >
            City
            <span className="text-[10px] tracking-[0.2em] text-white/55">12</span>
          </button>
        </div>
      )}

      {/* Room nav chips (mobile) */}
      {(inTour || phase === "door") && (
        <div className="absolute inset-x-0 top-28 flex gap-2 overflow-x-auto px-4 pb-1 md:hidden">
          {[...NAV_ORDER, { id: "tower" as TourLocationId, index: "12", label: "City" }].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => api()?.flyTo(item.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition ${
                location === item.id
                  ? "border-[#ffdf9e]/70 bg-black/60 text-[#ffdf9e]"
                  : "border-white/20 bg-black/40 text-white/75"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Floor selector in tower view */}
      {location === "tower" && inTour && (
        <div className="absolute bottom-28 left-1/2 flex -translate-x-1/2 gap-2">
          {FLOORS.map((floor, i) => (
            <button
              key={floor}
              type="button"
              onClick={() => {
                setFloorIndex(i);
                const st = stateRef.current;
                if (st.refs) {
                  import("./tour-scene").then((m) => m.moveFloorSlab(st.refs!, i)).catch(() => undefined);
                }
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition ${
                floorIndex === i
                  ? "border-[#ffdf9e]/70 bg-black/60 text-[#ffdf9e]"
                  : "border-white/20 bg-black/40 text-white/70 hover:border-white/50"
              }`}
            >
              {floor}
            </button>
          ))}
        </div>
      )}

      {/* Room info card */}
      {infoKey && inTour && (
        <div className="absolute bottom-28 left-4 hidden max-w-[240px] rounded-2xl border border-white/15 bg-black/55 p-4 backdrop-blur-sm md:block">
          <p className="font-display text-lg text-white">{ROOM_INFO[infoKey].title}</p>
          <ul className="mt-2 space-y-1">
            {ROOM_INFO[infoKey].lines.map((line) => (
              <li key={line} className="text-xs text-white/70">
                {line}
              </li>
            ))}
          </ul>
          <Link
            href="/signup"
            className="mt-3 inline-block rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-white/85"
          >
            Explore matching properties
          </Link>
        </div>
      )}

{/* Property Intelligence Panel — replaces former Voice AI command bar */}
      {inTour && (
        <div
          className={`focus-mode-transition ${isFocusMode ? "focus-mode-hidden" : ""}`}
          style={{ pointerEvents: isFocusMode ? "none" : "auto" }}
        >
          <PropertyIntelligence
            currentLocation={location}
            onNavigate={(target) => api()?.flyTo(target)}
            inTour={inTour}
          />
        </div>
      )}

      {/* Focus Mode restore button — small floating button when UI is minimized */}
      {isFocusMode && (
        <button
          type="button"
          onClick={toggleFocusMode}
          aria-label="Show property controls"
          title="Show property controls"
          className="absolute left-4 bottom-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white/80 backdrop-blur-sm focus-mode-restore-btn"
        >
          <Minimize2 size={20} />
        </button>
      )}

      {/* Property Explorer panel */}
      <PropertyExplorer isOpen={isPropertyExplorerOpen} onClose={closePropertyExplorer} />
    </div>
  );
}

/**
 * Cinematic fallback when WebGL is genuinely unavailable (the capability
 * probe itself failed every safe configuration). Same villa story, same warm
 * grade, poster visual + room gallery — never a dark text-only list as the
 * primary experience. Retry re-probes and re-initializes in place.
 */
function TourCinematicFallback({ headingLevel = "h1", onRetry }: { headingLevel?: HeadingTag; onRetry: () => void }) {
  const poster = "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1800&q=80";
  const rooms = [
    { label: "Living Room", img: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=800&q=70" },
    { label: "Kitchen", img: "https://images.unsplash.com/photo-1556912167-f556f1f39fdf?auto=format&fit=crop&w=800&q=70" },
    { label: "Bedroom", img: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=800&q=70" },
    { label: "Bathroom", img: "https://images.unsplash.com/photo-1620626011761-996317b8d101?auto=format&fit=crop&w=800&q=70" },
    { label: "Pool", img: "https://images.unsplash.com/photo-1572331165267-854da2b10ccc?auto=format&fit=crop&w=800&q=70" },
    { label: "Terrace", img: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70" },
  ];
  const Heading = headingLevel;
  return (
    <div className="relative flex min-h-[100svh] w-full flex-col overflow-hidden bg-[#1a2030] text-white">
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${poster}')` }} />
      <div className="absolute inset-0" style={FALLBACK_POSTER_STYLE} />
      <div className="absolute inset-0" style={FALLBACK_GRADE_STYLE} />
      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <p className="font-display text-3xl tracking-[0.35em] drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">BASERA</p>
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#ffdf9e]">Aurum Villa · Cinematic preview</p>
        <Heading className="font-display text-3xl leading-tight md:text-4xl">The same villa, in film stills — your device blocked interactive 3D.</Heading>
        <p className="max-w-xl text-sm leading-7 text-white/75">
          This browser or device did not offer WebGL, so the live 3D tour cannot start here. The property story below
          uses the same golden-hour grade as the realtime world — and the full interactive tour works on any
          WebGL-enabled phone or desktop.
        </p>
        <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-3">
          {rooms.map((r) => (
            <figure key={r.label} className="overflow-hidden rounded-2xl border border-white/15 bg-black/40 backdrop-blur-sm">
              <div className="h-28 bg-cover bg-center md:h-32" style={{ backgroundImage: `url('${r.img}')` }} />
              <figcaption className="px-3 py-2 text-left text-xs font-semibold text-white/85">{r.label}</figcaption>
            </figure>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={onRetry} className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-white/85">
            Retry 3D tour
          </button>
          <Link href="/signup" className="rounded-full border border-white/30 bg-black/45 px-6 py-2.5 text-sm font-medium text-white backdrop-blur-sm transition hover:border-white/60">
            Explore Basera
          </Link>
          <Link href="/" className="rounded-full border border-white/20 px-6 py-2.5 text-sm text-white/75 transition hover:text-white">
            Back home
          </Link>
        </div>
        <p className="text-[11px] text-white/60">Tip: enable hardware acceleration / WebGL in your browser settings, then retry.</p>
      </div>
    </div>
  );
}
