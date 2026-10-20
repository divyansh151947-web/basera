"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Scroll-triggered reveal wrapper (transform + opacity only — GPU-cheap).
 * Respects prefers-reduced-motion (content renders visible immediately).
 * No animation libraries; SHARED IntersectionObserver for all instances.
 */
let sharedRevealObserver: IntersectionObserver | null = null;
const revealElements = new Set<HTMLDivElement>();

function getSharedObserver() {
  if (typeof window === "undefined" || typeof IntersectionObserver !== "function") return null;
  if (sharedRevealObserver) return sharedRevealObserver;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  
  sharedRevealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLDivElement;
          el.classList.add("reveal-visible");
          revealElements.delete(el);
          sharedRevealObserver!.unobserve(el);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  return sharedRevealObserver;
}

export function Reveal({
  children,
  className = "",
  delayMs = 0,
  y = 22,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  y?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    
    const observer = getSharedObserver();
    if (!observer) {
      el.classList.add("reveal-visible");
      return;
    }
    
    revealElements.add(el);
    observer.observe(el);
    return () => {
      revealElements.delete(el);
      observer.unobserve(el);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${className}`}
      style={{ ["--reveal-y" as string]: `${y}px`, transitionDelay: delayMs > 0 ? `${delayMs}ms` : undefined }}
    >
      {children}
    </div>
  );
}
