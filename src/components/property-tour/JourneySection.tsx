"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { JOURNEY_STAGES, type JourneyStage } from "./tour-journey";
import { Reveal } from "@/components/reveal";
import { CheckCircle2, ArrowRight, Sparkles, Home, Brain, Search, Target, Layers, TrendingUp, CalendarCheck2, ChevronRight, MessageSquare, Zap } from "lucide-react";

/**
 * Scroll-driven BASERA product story (landing only).
 * Pure CSS/HTML narrative — NO 3D canvas. The interactive 3D tour lives in
 * PropertyTour above; this section tells the story through scroll-triggered
 * text, visualizations, and visual rhythm. Same cinematic theme, zero GPU cost.
 *
 * FIVE STAGES: DISCOVER → MATCH → INTELLIGENCE → EXPLORE → CONVERT
 * NO room labels (Living, Kitchen, Bedroom, etc.) — those belong ONLY in the 3D PropertyTour.
 */

// Pre-computed particle positions to avoid inline style recalculation
const PARTICLE_DATA = [
  { w: 8, h: 8, left: "5%", top: "10%", delay: "0s", duration: "12s" },
  { w: 14, h: 14, left: "13.3%", top: "23%", delay: "0.7s", duration: "15s" },
  { w: 8, h: 8, left: "21.6%", top: "36%", delay: "1.4s", duration: "13s" },
  { w: 14, h: 14, left: "29.9%", top: "49%", delay: "2.1s", duration: "16s" },
  { w: 8, h: 8, left: "38.2%", top: "62%", delay: "2.8s", duration: "14s" },
  { w: 14, h: 14, left: "46.5%", top: "75%", delay: "3.5s", duration: "17s" },
  { w: 8, h: 8, left: "54.8%", top: "8%", delay: "4.2s", duration: "12s" },
  { w: 14, h: 14, left: "63.1%", top: "21%", delay: "4.9s", duration: "15s" },
  { w: 8, h: 8, left: "71.4%", top: "34%", delay: "5.6s", duration: "13s" },
  { w: 14, h: 14, left: "79.7%", top: "47%", delay: "6.3s", duration: "16s" },
  { w: 8, h: 8, left: "88%", top: "60%", delay: "7s", duration: "14s" },
  { w: 14, h: 14, left: "96.3%", top: "73%", delay: "7.7s", duration: "17s" },
];

export function JourneySection() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const readProgress = () => {
      const rect = container.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      return total > 0 ? Math.min(1, Math.max(0, (window.innerHeight * 0.5 - rect.top) / total)) : 0;
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const p = readProgress();
        const nextStage = stageForProgress(p);
        if (nextStage !== stage) setStage(nextStage);
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [stage]);

  const active = JOURNEY_STAGES[stage] ?? JOURNEY_STAGES[0];

  return (
    /*
      Below xl (phones, tablets, small laptops) this is a NORMAL vertical
      section: each stage renders its narrative followed by its visualization
      in document flow, so nothing can overlap. The pinned scroll-story below
      only ever worked when both panels had ~1280px+ of horizontal room —
      measured overlap at 320/360/375/390/414/430/768/1024 before this change.

      At xl+ the original pinned scroll-story is preserved exactly: the
      wrapper is a sticky full-viewport stage and each stage's narrative and
      visualization are absolutely-positioned overlays (left column + right
      column). Because every stage item is `position: absolute` at xl+, it
      contributes no layout height, so stage changes cannot shift anything —
      the old `grid`/`gridArea` height-reservation trick (and its CLS comments)
      is no longer needed.
    */
    <section ref={containerRef} className="relative bg-[#0a0e16] xl:h-[340vh]">
      <div className="relative w-full overflow-hidden pt-14 pb-28 xl:sticky xl:top-0 xl:h-screen xl:p-0">
        {/* Cinematic atmospheric backdrop — pure CSS, no WebGL */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(255,170,100,0.10) 0%, rgba(20,26,44,0.06) 45%, rgba(10,12,22,0.22) 100%)", mixBlendMode: "soft-light" }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(8,10,18,0.38) 100%)" }} />
        <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E\")" }} />

        {/* Floating ambient particles — pre-computed, CSS animation only */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {PARTICLE_DATA.map((p, i) => (
            <span key={i} className="absolute rounded-full bg-[#ffdf9e]/20 animate-float" style={{
              width: `${p.w}px`,
              height: `${p.h}px`,
              left: p.left,
              top: p.top,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }} />
          ))}
        </div>

        {/* NO room-based floating chips — removed completely. Room navigation belongs in 3D PropertyTour only. */}

        {/* Stage content — narrative + visualization per stage (see note above) */}
        <div className="max-xl:space-y-16">
          {JOURNEY_STAGES.map((s) => (
            <div
              key={s.index}
              className={`${s.index === active.index ? "" : "xl:invisible"} xl:absolute xl:inset-0`}
            >
              {/* Narrative — in flow below xl; pinned left column at xl+ */}
              <div className="max-w-xl p-6 md:p-10 xl:pointer-events-none xl:absolute xl:inset-y-0 xl:left-0 xl:flex xl:w-full xl:flex-col xl:justify-center xl:gap-3 xl:p-12 xl:max-w-2xl">
                <Reveal>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#ffdf9e]">0{s.index + 1} / 05 — {s.eyebrow}</p>
                  <h2 className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.05] text-white mt-2 max-w-lg">{s.title}</h2>
                  <p className="max-w-md text-base md:text-lg leading-8 text-white/70 mt-4">{s.body}</p>
                </Reveal>
                <Reveal delayMs={120}>
                  {s.chips.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {s.chips.map((chip) => (
                        <span
                          key={chip}
                          className="rounded-full border border-white/25 bg-black/45 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white/85"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  )}
                </Reveal>
                <Reveal delayMs={200}>
                  {s.index >= JOURNEY_STAGES.length - 1 && (
                    <div className="pointer-events-auto mt-6">
                      <Link
                        href="/signup"
                        className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-[#0a0e16] transition hover:bg-white/90"
                      >
                        Start Free
                        <ArrowRight size={16} />
                      </Link>
                    </div>
                  )}
                </Reveal>
              </div>

              {/* Visualization — in flow below xl; pinned right column at xl+ */}
              <div className="max-w-3xl mt-6 p-6 md:p-10 xl:pointer-events-none xl:absolute xl:inset-y-0 xl:right-0 xl:mt-0 xl:flex xl:w-full xl:flex-col xl:justify-center xl:items-end xl:gap-6 xl:p-12 xl:max-w-4xl">
                <Reveal delayMs={80}>
                  <StageVisualization stage={s} />
                </Reveal>
              </div>
            </div>
          ))}
        </div>

        {/* Progress indicator — 5 dots only (pinned story at xl+) */}
        <div className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 gap-1.5 xl:flex">
          {JOURNEY_STAGES.map((s) => (
            <span
              key={s.index}
              className={`h-1 rounded-full transition-all duration-500 ${
                s.index === stage ? "w-6 bg-[#ffdf9e]" : "w-2 bg-white/25"
              }`}
            />
          ))}
        </div>

        {/* Scroll cue — pinned story only (xl+) */}
        <div className="absolute bottom-6 left-1/2 hidden items-center gap-2 -translate-x-1/2 text-white/60 xl:flex">
          <span className="block h-8 w-px overflow-hidden bg-white/20">
            <span className="scroll-cue-line block h-full w-px bg-[#ffdf9e]" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em]">Scroll to continue</span>
        </div>
      </div>
    </section>
  );
}

/** Stage index for scroll progress p in [0,1]. */
function stageForProgress(p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  const idx = Math.floor(clamped * JOURNEY_STAGES.length);
  return Math.min(JOURNEY_STAGES.length - 1, idx);
}

/** Stage visualization components — each visually distinct and LARGE */
function StageVisualization({ stage }: { stage: JourneyStage }) {
  const leadData = stage.leadData;

  switch (stage.index) {
    case 0:
      return <DiscoverVisualization data={leadData} />;
    case 1:
      return <MatchVisualization data={leadData} />;
    case 2:
      return <IntelligenceVisualization data={leadData} />;
    case 3:
      return <ExploreVisualization data={leadData} />;
    case 4:
      return <ConvertVisualization data={leadData} />;
    default:
      return null;
  }
}

/** STAGE 01 — DISCOVER: Natural language → structured understanding */
function DiscoverVisualization({ data }: { data?: JourneyStage["leadData"] }) {
  const extracted = data?.extracted ?? { Location: "Jaipur", Configuration: "3 BHK", Budget: "₹2 Cr", Intent: "Family Home" };
  const query = data?.query ?? '"I want a spacious 3 BHK in Jaipur around ₹2 Cr for my family."';

  return (
    <div className="w-full max-w-2xl">
      {/* Large conversation card visualization */}
      <div className="rounded-[1.6rem] border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-6 md:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur-sm relative overflow-hidden">
        {/* Subtle animated background lines */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#d8a94e]/20 to-transparent" style={{ top: `${15 + i * 14}%`, animation: `slideLine ${20 + i * 3}s linear infinite` }} />
          ))}
        </div>

        <div className="relative z-10">
          {/* User message */}
          <div className="flex gap-4 mb-6">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#d8a94e]/30 to-[#8a6238]/30 border border-[#d8a94e]/40">
              <span className="font-display text-lg text-[#ffdf9e]">U</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white/50 uppercase tracking-[0.1em] mb-1">You tell Basera</p>
              <p className="text-lg md:text-xl text-white leading-relaxed italic">{"\u201C"}{query}{"\u201D"}</p>
            </div>
          </div>

          {/* Animated arrow/transformation */}
          <div className="flex items-center justify-center my-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d8a94e]/20 border border-[#d8a94e]/40 animate-pulse">
              <Zap size={20} className="text-[#ffdf9e]" />
            </div>
          </div>

          {/* Extracted understanding — LARGE, prominent */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4 border-t border-white/10">
            {Object.entries(extracted).map(([key, value]) => (
              <div key={key} className="text-center p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-[#d8a94e]/30 hover:bg-white/[0.05] transition-all duration-300">
                <p className="font-display text-2xl md:text-3xl text-[#ffdf9e] font-medium">{value}</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/50 mt-1">{key}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Caption */}
      <p className="text-center text-sm text-white/50 mt-4 max-w-lg mx-auto">
        Basera extracts structured requirements from natural conversation — no forms, no filters.
      </p>
    </div>
  );
}

/** STAGE 02 — MATCH: One dominant property match with alternatives */
function MatchVisualization({ data }: { data?: JourneyStage["leadData"] }) {
  const properties = data?.properties ?? [
    { name: "Aurum Heights", price: "₹1.85 Cr", location: "Jaipur", matched: true, image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70" },
    { name: "Skyline Crest", price: "₹2.10 Cr", location: "Jaipur", matched: false, image: "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=800&q=70" },
    { name: "Harbor Point", price: "₹1.95 Cr", location: "Jaipur", matched: false, image: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70" },
  ];

  const matched = properties.find(p => p.matched) ?? properties[0];
  const alternatives = properties.filter(p => !p.matched);

  return (
    <div className="w-full max-w-3xl">
      {/* Main matched property — LARGE, dominant */}
      <div className="rounded-[1.6rem] border border-[#d8a94e]/40 bg-gradient-to-br from-[#d8a94e]/10 via-white/[0.03] to-white/[0.02] overflow-hidden shadow-[0_25px_60px_rgba(216,169,78,0.15)] relative">
        {/* Badge */}
        <div className="absolute top-4 left-4 z-10">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#d8a94e] px-4 py-1.5 text-sm font-semibold text-[#1a1206] shadow-[0_8px_24px_rgba(216,169,78,0.4)]">
            <CheckCircle2 size={14} />
            Matched for You
          </span>
        </div>

        {/* Property image */}
        <div className="relative h-64 md:h-80 overflow-hidden">
          <Image
            src={matched.image ?? "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70"}
            alt={matched.name}
            fill
            sizes="(max-width: 768px) 100vw, 60vw"
            priority
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e16]/90 via-transparent to-transparent" />
        </div>

        {/* Property details overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#ffdf9e] mb-1">{matched.location}</p>
          <p className="font-display text-2xl md:text-3xl text-white font-medium">{matched.name}</p>
          <div className="flex items-baseline gap-4 mt-2">
            <span className="font-display text-3xl md:text-4xl text-[#ffdf9e]">{matched.price}</span>
            <span className="text-sm text-white/60">3 BHK · Ready to move</span>
          </div>
        </div>
      </div>

      {/* Alternatives — subtle, smaller */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        {alternatives.map((prop, i) => (
          <div key={prop.name} className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden hover:border-white/20 hover:bg-white/[0.05] transition-all duration-300 group">
            <div className="relative h-32 overflow-hidden">
              <Image
                src={prop.image ?? "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70"}
                alt={prop.name}
                fill
                sizes="50vw"
                className="object-cover object-center transition-transform duration-500 group-hover:scale-105"
              />
            </div>
            <div className="p-4">
              <p className="text-sm font-medium text-white truncate">{prop.name}</p>
              <p className="text-[11px] text-white/50 mb-2">{prop.location}</p>
              <p className="font-display text-lg text-[#ffdf9e]">{prop.price}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-sm text-white/50 mt-4 max-w-lg mx-auto">
        Basera ranks verified inventory against your requirements — one clear match, not endless scrolling.
      </p>
    </div>
  );
}

/** STAGE 03 — INTELLIGENCE: Why it fits — decision intelligence */
function IntelligenceVisualization({ data }: { data?: JourneyStage["leadData"] }) {
  const highlights = data?.selectedProperty?.highlights ?? [
    "✓ 3 BHK requirement — matches exactly",
    "✓ Within budget — ₹1.85 Cr vs ₹2 Cr target",
    "✓ Preferred location — Jaipur, prime sector",
    "✓ Family suitable — parks, schools, community",
    "✓ Ready to move — immediate possession",
  ];

  return (
    <div className="w-full max-w-2xl">
      {/* Large intelligence card */}
      <div className="rounded-[1.6rem] border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-6 md:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur-sm relative overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#d8a94e]/30 to-[#8a6238]/30 border border-[#d8a94e]/40">
            <Brain size={24} className="text-[#ffdf9e]" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/50">Property Intelligence</p>
            <p className="text-lg font-medium text-white">Aurum Heights</p>
          </div>
        </div>

        {/* Property snapshot — compact */}
        <div className="grid grid-cols-4 gap-3 mb-6 p-4 rounded-xl bg-white/[0.03] border border-white/5">
          <SnapshotItem label="Config" value="3 BHK" />
          <SnapshotItem label="Area" value="1,850 sq ft" />
          <SnapshotItem label="Price" value="₹1.85 Cr" accent />
          <SnapshotItem label="Location" value="Jaipur" />
        </div>

        {/* Why it fits — LARGE checklist */}
        <div className="space-y-3">
          {highlights.map((highlight, i) => (
            <div
              key={i}
              className="flex items-start gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-[#d8a94e]/20 hover:bg-white/[0.04] transition-all duration-300 group"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#d8a94e]/15 text-[#ffdf9e] group-hover:bg-[#d8a94e]/30 group-hover:scale-110 transition-all duration-300">
                <CheckCircle2 size={20} />
              </div>
              <p className="text-base md:text-lg text-white/90 leading-relaxed pt-1">{highlight}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-sm text-white/50 mt-4 max-w-lg mx-auto">
        Basera does not just show properties — it explains WHY they fit your specific requirements.
      </p>
    </div>
  );
}

function SnapshotItem({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <p className="font-display text-xl md:text-2xl font-medium {accent ? 'text-[#ffdf9e]' : 'text-white'}">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/50 mt-0.5">{label}</p>
    </div>
  );
}

/** STAGE 04 — EXPLORE: 3D exploration teaser */
function ExploreVisualization({ data }: { data?: JourneyStage["leadData"] }) {
  const highlights = data?.selectedProperty?.highlights ?? [
    "Full 3D villa walkthrough",
    "Room-to-room navigation",
    "Golden-hour lighting simulation",
    "Architectural details at scale",
  ];

  return (
    <div className="w-full max-w-3xl">
      {/* Large 3D preview frame */}
      <div className="rounded-[1.6rem] border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.02] overflow-hidden shadow-[0_25px_60px_rgba(0,0,0,0.4)] relative">
        {/* 3D viewport simulation */}
        <div className="relative h-72 md:h-96 bg-gradient-to-br from-[#0a0e16] via-[#1a2030] to-[#0a0e16]">
          {/* Simulated 3D scene with architectural wireframe feel */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-24 h-24 md:w-32 md:h-32 rounded-full border-2 border-[#d8a94e]/30 bg-[#d8a94e]/5 mb-4 animate-pulse" />
              <p className="font-display text-xl md:text-2xl text-white/80">3D Property Tour</p>
              <p className="text-sm text-white/50 mt-1">Aurum Heights · Live 3D</p>
            </div>
          </div>

          {/* Corner indicators */}
          <div className="absolute top-6 left-6 w-16 h-16 border-t-2 border-l-2 border-[#d8a94e]/50" />
          <div className="absolute top-6 right-6 w-16 h-16 border-t-2 border-r-2 border-[#d8a94e]/50" />
          <div className="absolute bottom-6 left-6 w-16 h-16 border-b-2 border-l-2 border-[#d8a94e]/50" />
          <div className="absolute bottom-6 right-6 w-16 h-16 border-b-2 border-r-2 border-[#d8a94e]/50" />

          {/* Navigation hint */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 text-white/60">
            <span className="h-6 w-px bg-white/30 animate-pulse" />
            <span className="text-[11px] uppercase tracking-[0.2em]">Navigate</span>
            <ChevronRight size={14} className="animate-bounce" />
          </div>
        </div>

        {/* Capabilities */}
        <div className="p-6 md:p-8 border-t border-white/10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[#ffdf9e] mb-4">Explore Capabilities</p>
          <div className="grid grid-cols-2 gap-3">
            {highlights.map((h, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#d8a94e]/15 text-[#ffdf9e]">
                  <Layers size={18} />
                </div>
                <p className="text-sm text-white/85">{h}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA to actual 3D tour */}
      <div className="mt-6 text-center">
        <Link
          href="/tour"
          className="inline-flex items-center gap-2 rounded-full border border-[#d8a94e]/40 bg-[#d8a94e]/10 px-6 py-3 text-sm font-semibold text-[#ffdf9e] hover:bg-[#d8a94e]/20 transition-all"
        >
          <Sparkles size={16} />
          Explore in 3D
          <ArrowRight size={14} />
        </Link>
      </div>

      <p className="text-center text-sm text-white/50 mt-4 max-w-lg mx-auto">
        Walk the property before you visit. Understand space, light, and flow — not just photos.
      </p>
    </div>
  );
}

/** STAGE 05 — CONVERT: Pipeline from interest to deal */
function ConvertVisualization({ data }: { data?: JourneyStage["leadData"] }) {
  const steps = data?.pipelineSteps ?? [
    "Interest Captured",
    "Property Matched",
    "Site Visit Scheduled",
    "Follow-up Active",
    "Lead Qualified",
    "Deal Closed",
  ];

  return (
    <div className="w-full max-w-2xl">
      {/* Large conversion pipeline visualization */}
      <div className="rounded-[1.6rem] border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-6 md:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.4)] backdrop-blur-sm relative overflow-hidden">
        {/* Pipeline */}
        <div className="space-y-4">
          {steps.map((step, i) => (
            <div key={step} className="flex items-center gap-4 relative group">
              {/* Connecting line */}
              {i < steps.length - 1 && (
                <div className="absolute left-11 top-12 bottom-[-28px] w-px bg-gradient-to-b from-[#d8a94e]/30 to-transparent" />
              )}

              {/* Step circle */}
              <div className="relative flex h-22 w-22 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 group-hover:scale-110 z-10"
                style={{
                  borderColor: i === steps.length - 1 ? "#d8a94e" : "rgba(216,169,78,0.3)",
                  backgroundColor: i === steps.length - 1 ? "#d8a94e" : "transparent",
                }}
              >
                {i === steps.length - 1 ? (
                  <CheckCircle2 size={28} className="text-[#1a1206]" />
                ) : (
                  <span className="font-display text-2xl font-bold text-[#ffdf9e]">{i + 1}</span>
                )}
              </div>

              {/* Step label */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white/50 uppercase tracking-[0.1em] mb-0.5">Step {i + 1}</p>
                <p className="text-lg md:text-xl font-medium text-white">{step}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Key metrics row — three columns from sm; stacked full-width cards
            below sm where 3-across leaves only ~43px of usable width (labels
            and values clipped at 320–374 otherwise). */}
        <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
          <MetricCard label="Avg. Time to Visit" value="3 days" icon={<CalendarCheck2 size={20} />} />
          <MetricCard label="Follow-up Rate" value="96%" icon={<MessageSquare size={20} />} />
          <MetricCard label="Conversion Lift" value="2.4x" icon={<TrendingUp size={20} />} />
        </div>
      </div>

      <p className="text-center text-sm text-white/50 mt-4 max-w-lg mx-auto">
        From first conversation to closed deal — Basera connects every step of the property journey.
      </p>
    </div>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center hover:border-[#d8a94e]/30 hover:bg-white/[0.05] transition-all">
      <div className="flex items-center justify-center gap-2 text-[#ffdf9e] mb-2">{icon}</div>
      <p className="font-display text-2xl text-[#ffdf9e]">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/50 mt-1">{label}</p>
    </div>
  );
}