"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play, AlertCircle, Film, MapPin, ArrowRight } from "lucide-react";

// Homepage "AI Property Videos" section, now driven by the workspace's REAL
// published properties (selected server-side — see src/lib/featured-video.ts
// and the server call in src/app/page.tsx). This component renders whatever
// property video it is given:
//   • videoUrl present → large user-initiated player (never autoplay with
//     sound) titled with that property's name/city/locality, linking to its
//     listing page.
//   • nothing given    → an honest empty state ("upload a walkthrough to
//     feature it here") — not a fabricated reel.
// Basera does not auto-generate videos; staff upload MP4s per property.

export interface ShowcaseProperty {
  id: string;
  title: string;
  city: string;
  locality: string;
  videoUrl: string;
  videoPosterUrl?: string | null;
}

type MediaState = "idle" | "loading" | "ready" | "error";

export function AIVideoShowcase({ property }: { property?: ShowcaseProperty | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<MediaState>("idle");
  const [sourceMissing, setSourceMissing] = useState(false);
  const [playing, setPlaying] = useState(false);

  const videoSrc = property?.videoUrl ?? null;
  const posterSrc = property?.videoPosterUrl ?? null;

  // Probe the source once so a missing/blocked asset degrades to an honest
  // unavailable state instead of a broken player.
  //
  // Deferred until the browser is idle: on mount this HEAD request competed
  // with the hero image + font fetches for bandwidth on the LCP critical path.
  // The probe is a UX nicety, so it runs after first paint (or as soon as the
  // section scrolls into view) rather than during load.
  useEffect(() => {
    if (!videoSrc) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const probe = () => {
      fetch(videoSrc, { method: "HEAD" })
        .then((res) => {
          if (cancelled) return;
          if (res.ok) setState("loading");
          else {
            setSourceMissing(true);
            setState("error");
          }
        })
        .catch(() => {
          if (cancelled) return;
          setSourceMissing(true);
          setState("error");
        });
    };

    const ric = (window as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof ric === "function") {
      ric(probe, { timeout: 3000 });
    } else {
      timer = setTimeout(probe, 1500);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [videoSrc]);

  function startPlayback() {
    const video = videoRef.current;
    if (!video) return;
    setState("loading");
    video
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        setPlaying(false);
        setState("error");
      });
  }

  return (
    <section id="ai-videos" aria-label="AI property videos" className="relative scroll-mt-20 overflow-hidden border-y border-white/10 bg-[#0d1322]">
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 55% 45% at 20% 0%, rgba(216,169,78,0.10), transparent 70%)" }} aria-hidden />
      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/65">
              <span className="hidden h-px w-8 bg-[#d8a94e]/70 sm:block" aria-hidden />
              Cinematic listings
            </p>
            <h2 className="mt-5 font-display text-[clamp(1.9rem,3.4vw,2.8rem)] leading-tight text-white">
              AI Property Videos
            </h2>
            <p className="mt-4 max-w-md text-base leading-7 text-white/70">
              Properties sell better in motion. Basera lets your team attach a cinematic walkthrough video to any
              listing — buyers watch it right on the property page, alongside photos, pricing, and AI-matched
              recommendations.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-white/70">
              <li className="flex items-start gap-3">
                <Film size={17} className="mt-0.5 shrink-0 text-[#ffdf9e]" />
                Staff upload one MP4 per property from the dashboard — no editing tools required.
              </li>
              <li className="flex items-start gap-3">
                <MapPin size={17} className="mt-0.5 shrink-0 text-[#ffdf9e]" />
                {property
                  ? `Featured walkthrough: ${property.title}, ${property.locality}, ${property.city}.`
                  : "Every video belongs to a real published property — never stock footage."}
              </li>
            </ul>
            <p className="mt-6 text-xs leading-5 text-white/40">
              Basera does not auto-generate videos. Each walkthrough is produced and uploaded by the listing team
              and featured here once the property is published.
            </p>
          </div>

          <div className="relative">
            <div className="absolute -inset-3 rounded-[1.75rem] bg-gradient-to-br from-[#d8a94e]/25 via-transparent to-[#d8a94e]/10 blur-xl" aria-hidden />
            <div className="relative overflow-hidden rounded-[1.5rem] border border-white/15 bg-black shadow-[0_28px_70px_rgba(0,0,0,0.55)]">
              {!videoSrc ? (
                /* Empty state: no published property has an uploaded video yet. */
                <div className="flex aspect-video flex-col items-center justify-center gap-3 p-8 text-center">
                  <Film size={26} className="text-[#ffdf9e]" />
                  <p className="text-sm font-medium text-white">No property walkthroughs yet</p>
                  <p className="max-w-xs text-xs leading-5 text-white/50">
                    When the team uploads a video to a published property, it is featured here automatically.
                    Browse{" "}
                    <Link href="/explore" className="underline decoration-[#d8a94e]/60 underline-offset-2 hover:text-[#ffdf9e]">
                      all listings
                    </Link>{" "}
                    in the meantime.
                  </p>
                </div>
              ) : sourceMissing ? (
                <div className="flex aspect-video flex-col items-center justify-center gap-3 p-8 text-center">
                  <AlertCircle size={26} className="text-[#ffdf9e]" />
                  <p className="text-sm font-medium text-white">Video preview unavailable</p>
                  <p className="max-w-xs text-xs leading-5 text-white/50">
                    This property&apos;s walkthrough could not be loaded right now. It stays available on the listing
                    page.
                  </p>
                  {property && (
                    <Link
                      href={`/explore/${property.id}`}
                      className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/85 transition hover:border-white/50"
                    >
                      View listing <ArrowRight size={13} />
                    </Link>
                  )}
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    className="aspect-video w-full bg-black object-cover"
                    controls
                    playsInline
                    preload="metadata"
                    poster={posterSrc ?? undefined}
                    onLoadedData={() => setState("ready")}
                    onCanPlay={() => setState("ready")}
                    onPlaying={() => {
                      setPlaying(true);
                      setState("ready");
                    }}
                    onError={() => {
                      setPlaying(false);
                      setSourceMissing(true);
                      setState("error");
                    }}
                  >
                    <source src={videoSrc} type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>

                  {/* Custom poster overlay: shown until playback starts, gives
                      a large explicit play affordance over the poster frame.
                      Playback is always user-initiated — never autoplay. */}
                  {!playing && state !== "error" && (
                    <button
                      type="button"
                      onClick={startPlayback}
                      aria-label={`Play the walkthrough video for ${property?.title ?? "this property"}`}
                      className="group absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/55 via-transparent to-black/25 transition hover:bg-black/20"
                      style={
                        posterSrc
                          ? {
                              backgroundImage: `linear-gradient(to top, rgba(0,0,0,0.55), transparent 55%), url(${posterSrc})`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }
                          : undefined
                      }
                    >
                      <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/30 bg-[#d8a94e] shadow-[0_12px_34px_rgba(0,0,0,0.5)] transition-transform duration-200 group-hover:scale-105">
                        <Play size={24} className="ml-0.5 text-black" fill="black" />
                      </span>
                    </button>
                  )}

                  {state === "error" && !sourceMissing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-6 text-center">
                      <AlertCircle size={22} className="text-red-400" />
                      <p className="text-sm text-white">Playback failed. Try again or check your connection.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setState("loading");
                          setPlaying(false);
                          videoRef.current?.load();
                        }}
                        className="mt-1 rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/85 transition hover:border-white/50"
                      >
                        Reload video
                      </button>
                    </div>
                  )}

                  {/* Property attribution overlay: makes it obvious WHICH
                      property is playing and links to its listing page. */}
                  {property && !playing && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-10">
                      <p className="pointer-events-auto truncate font-display text-lg text-white">{property.title}</p>
                      <p className="pointer-events-auto mt-0.5 flex items-center gap-1.5 text-xs text-white/70">
                        <MapPin size={12} className="shrink-0 text-[#ffdf9e]" />
                        {property.locality}, {property.city}
                        <Link
                          href={`/explore/${property.id}`}
                          aria-label={`View listing for ${property.title}`}
                          className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/25 bg-black/40 px-2.5 py-1 text-[11px] font-semibold text-white/90 transition hover:border-[#d8a94e] hover:text-[#ffdf9e]"
                        >
                          View listing <ArrowRight size={11} />
                        </Link>
                      </p>
                    </div>
                  )}

                  <span className="pointer-events-none absolute left-3 top-3 rounded-full border border-[#d8a94e]/40 bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ffdf9e] backdrop-blur-sm">
                    Property walkthrough
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Alias kept for readability at call sites that want the intent by name.
export const PropertyVideoShowcase = AIVideoShowcase;
