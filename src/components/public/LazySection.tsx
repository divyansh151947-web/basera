"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Rendered instead of `children` until the section nears the viewport. */
  fallback?: ReactNode;
  /**
   * How far outside the viewport to start hydrating, in px. Kept generous so
   * heavy below-the-fold sections (3D tour, journey) are mounted before the
   * user reaches them, while still staying off the critical path.
   */
  rootMargin?: string;
  /**
   * Also require `window`'s `load` event before mounting, even when the
   * section is already inside `rootMargin`.
   *
   * Why this exists: on the homepage the 3D sections start roughly one
   * viewport down, so a generous `rootMargin` alone made them mount almost
   * immediately after hydration — meaning the three.js chunk downloaded at
   * ~1.9s and its ~1.3s parse ran as a single main-thread task right when the
   * LCP hero image finished downloading. Because that parse is one
   * uninterrupted task, it held the image's paint: the image's *download*
   * time was unchanged, but LCP was pushed ~0.6-1.2s later.
   *
   * Waiting for `load` defers the parse until the LCP image is already in, so
   * the two never contend. The mount still happens promptly for fast
   * connections (where `load` fires early) and E2E (Playwright navigates with
   * `waitUntil: "load"`), and `LOAD_SAFETY_TIMEOUT_MS` guarantees the section
   * always mounts even if one unrelated slow resource stalls `load`.
   */
  waitForLoad?: boolean;
  /** Minimum height reserved before mount so mounting never shifts layout. */
  minHeight?: number;
};

/** Never hold a section hostage to an unrelated resource stalling `load`. */
const LOAD_SAFETY_TIMEOUT_MS = 8000;

/**
 * Defers rendering (and therefore hydration + chunk download) of a heavy
 * below-the-fold section until it approaches the viewport.
 *
 * Used to keep the three.js/`@react-three/fiber` bundle (~190 KB gzip'd across
 * two chunks) out of the homepage's post-hydration critical path, which was
 * costing ~1.3s of LCP under slow-4G/4x-CPU conditions.
 */
export default function LazySection({
  children,
  fallback = null,
  rootMargin = "600px 0px",
  waitForLoad = false,
  minHeight,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  useEffect(() => {
    if (!waitForLoad || loaded) return;
    if (document.readyState === "complete") {
      setLoaded(true);
      return;
    }
    const onLoad = () => setLoaded(true);
    window.addEventListener("load", onLoad);
    const safety = window.setTimeout(() => setLoaded(true), LOAD_SAFETY_TIMEOUT_MS);
    return () => {
      window.removeEventListener("load", onLoad);
      window.clearTimeout(safety);
    };
  }, [waitForLoad, loaded]);

  const canMount = visible && (!waitForLoad || loaded);

  return (
    <div ref={ref} style={minHeight ? { minHeight } : undefined}>
      {canMount ? children : fallback}
    </div>
  );
}
