"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type * as THREE from "three";
import { formatInr } from "@/lib/formatters";
import { resolveTourEnv } from "./tour-env";

/**
 * Ambient revenue visual for the dashboard (selective 3D, never a game).
 *
 * A slow-orbiting tower cluster behind the at-risk figure, linking to the
 * full recovery view. Lazy-loaded three.js, paused when hidden or when the
 * user prefers reduced motion; renders nothing WebGL on failure (the
 * figures below always stand alone).
 */
export function RevenueTower({ atRisk, critical }: { atRisk: number; critical: number }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const detected = resolveTourEnv(window.innerWidth, window.devicePixelRatio);
    if (!detected.webgl || detected.reducedMotion) return;
    let cancelled = false;
    let raf = 0;
    let liveScene: THREE.Scene | null = null;
    let liveRenderer: THREE.WebGLRenderer | null = null;

    async function init() {
      try {
        const [sceneApi, THREE] = await Promise.all([import("./tour-scene"), import("three")]);
        if (cancelled) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(detected.pixelRatio, 1.5));
        renderer.setSize(mount!.clientWidth, mount!.clientHeight);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        mount!.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.fog = null;
        const camera = new THREE.PerspectiveCamera(50, mount!.clientWidth / mount!.clientHeight, 0.1, 300);
        scene.add(new THREE.HemisphereLight(0x8fa8d8, 0x11141a, 1.2));
        const key = new THREE.DirectionalLight(0xffe0b0, 1.4);
        key.position.set(14, 20, 10);
        scene.add(key);
        // Build ONLY the tower cluster (optimized: no villa, interior, pool, garden).
        sceneApi.buildCityOnly(scene, true);
        liveScene = scene;
        liveRenderer = renderer;
        camera.position.set(24, 15, 26);
        camera.lookAt(0, 8, -30);
        let visible = true;
        const observer = new IntersectionObserver((entries) => {
          visible = entries[0]?.isIntersecting ?? true;
        });
        observer.observe(mount!);
        let angle = 0.6;
        // Decorative backdrop: half-rate rendering with a doubled orbit step
        // keeps the EXACT same orbit speed for half the GPU.
        const stride = 2;
        let ticks = 0;
        const loop = () => {
          raf = requestAnimationFrame(loop);
          if (!visible || document.visibilityState !== "visible") return;
          ticks += 1;
          if (ticks % stride !== 0) return;
          angle += 0.0016 * stride;
          const r = 30;
          camera.position.set(Math.sin(angle) * r, 16, -52 + Math.cos(angle) * r);
          camera.lookAt(0, 10, -52);
          renderer.render(scene, camera);
        };
        raf = requestAnimationFrame(loop);
        return () => {
          observer.disconnect();
        };
      } catch {
        // Static fallback below already carries the figures.
      }
    }

    let cleanup: (() => void) | undefined;
    void init().then((c) => {
      cleanup = c;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cleanup?.();
      if (liveScene && liveRenderer) {
        import("./tour-scene").then((m) => m.disposeTourWorld(liveScene!, liveRenderer!)).catch(() => undefined);
      }
      if (mount) {
        while (mount.firstChild) {
          try {
            mount.removeChild(mount.firstChild);
          } catch {
            break;
          }
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-[#0d1420] p-5 shadow-[0_10px_25px_rgba(15,23,42,0.08)]">
      <div ref={mountRef} className="pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="relative flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">Revenue at risk</p>
          <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">{formatInr(atRisk)}</p>
          <p className="mt-1 text-xs text-white/60">
            {critical > 0 ? `${critical} critical lead${critical === 1 ? "" : "s"} need${critical === 1 ? "s" : ""} attention` : "No critical leads right now"}
          </p>
        </div>
        <Link
          href="/recovery"
          className="btn-light rounded-xl px-4 py-2 text-xs"
        >
          Open recovery
        </Link>
      </div>
    </div>
  );
}
