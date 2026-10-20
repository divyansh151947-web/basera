import { easeInOutCubic, lerp } from "./tour-env";
import type { TourVec3 } from "./tour-types";

/**
 * Scroll-driven story staging (pure, unit-tested).
 *
 * Maps page scroll progress (0..1 across the journey container) to a camera
 * blend plus a caption stage. The 3D world reuses the tour scene builders;
 * only the choreography lives here. Conceptual captions describe the Basera
 * workflow — no fake numbers, no revenue claims.
 *
 * FIVE-STAGE BASERA PRODUCT STORY:
 * DISCOVER → MATCH → INTELLIGENCE → EXPLORE → CONVERT
 */

export interface JourneyCamera {
  pos: TourVec3;
  look: TourVec3;
}

export interface JourneyStage {
  index: number;
  eyebrow: string;
  title: string;
  body: string;
  /** Product capability chips highlighted at this stage (not rooms). */
  chips: string[];
  /** Illustrative lead data for this stage (marketing visualization only). */
  leadData?: {
    name?: string;
    query?: string;
    extracted?: Record<string, string>;
    properties?: Array<{ name: string; price: string; location: string; matched: boolean; image?: string }>;
    selectedProperty?: { name: string; highlights: string[] };
    pipelineSteps?: string[];
  };
}

export const JOURNEY_CAMERAS: JourneyCamera[] = [
  { pos: { x: 13, y: 4.2, z: 13 }, look: { x: 0, y: 2, z: -8 } },
  { pos: { x: 10, y: 5, z: 10 }, look: { x: 0, y: 2, z: -4 } },
  { pos: { x: 18, y: 8, z: 18 }, look: { x: 0, y: 3, z: -10 } },
  { pos: { x: 5, y: 6, z: 8 }, look: { x: -2, y: 2, z: -6 } },
  { pos: { x: 20, y: 12, z: 22 }, look: { x: 0, y: 5, z: -15 } },
];

export const JOURNEY_STAGES: JourneyStage[] = [
  {
    index: 0,
    eyebrow: "Discover",
    title: "Tell Basera what you're looking for.",
    body: "Natural language becomes a structured property search. No filters. No complexity.",
    chips: ["Natural Language", "AI Extraction", "Instant Understanding"],
    leadData: {
      name: "New Conversation",
      query: '"I want a spacious 3 BHK in Jaipur around ₹2 Cr for my family."',
      extracted: { Location: "Jaipur", Configuration: "3 BHK", Budget: "₹2 Cr", Intent: "Family Home" },
    },
  },
  {
    index: 1,
    eyebrow: "Match",
    title: "Stop searching. Start matching.",
    body: "Basera doesn't just filter listings. It finds properties that actually fit your requirements.",
    chips: ["Verified Inventory", "Requirement Fit", "Ranked Results"],
    leadData: {
      name: "Property Matches",
      properties: [
        { name: "Aurum Heights", price: "₹1.85 Cr", location: "Jaipur", matched: true, image: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70" },
        { name: "Skyline Crest", price: "₹2.10 Cr", location: "Jaipur", matched: false, image: "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=800&q=70" },
        { name: "Harbor Point", price: "₹1.95 Cr", location: "Jaipur", matched: false, image: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70" },
      ],
    },
  },
  {
    index: 2,
    eyebrow: "Intelligence",
    title: "Know why it fits.",
    body: "Basera doesn't just show a property. It helps you understand the decision with contextual intelligence.",
    chips: ["Requirement Fit", "Contextual Insights", "Decision Support"],
    leadData: {
      name: "Property Intelligence",
      selectedProperty: {
        name: "Aurum Heights",
        highlights: [
          "✓ 3 BHK requirement — matches exactly",
          "✓ Within budget — ₹1.85 Cr vs ₹2 Cr target",
          "✓ Preferred location — Jaipur, prime sector",
          "✓ Family suitable — parks, schools, community",
          "✓ Ready to move — immediate possession",
        ],
      },
    },
  },
  {
    index: 3,
    eyebrow: "Explore",
    title: "Explore before you visit.",
    body: "Immersive 3D walkthrough lets you understand the space, flow, and light — before scheduling a site visit.",
    chips: ["Live 3D Tour", "Spatial Understanding", "Architectural Detail"],
    leadData: {
      name: "3D Exploration",
      selectedProperty: {
        name: "Aurum Heights",
        highlights: [
          "Full 3D villa walkthrough",
          "Room-to-room navigation",
          "Golden-hour lighting simulation",
          "Architectural details at scale",
        ],
      },
    },
  },
  {
    index: 4,
    eyebrow: "Convert",
    title: "From first conversation to closed deal.",
    body: "Basera connects discovery, intelligence, and conversion — turning interest into action through structured follow-up.",
    chips: ["Site Visit", "Automated Follow-up", "Qualified Lead", "Deal"],
    leadData: {
      name: "Conversion Pipeline",
      pipelineSteps: [
        "Interest Captured",
        "Property Matched",
        "Site Visit Scheduled",
        "Follow-up Active",
        "Lead Qualified",
        "Deal Closed",
      ],
    },
  },
];

/** Stage index for scroll progress p in [0,1]. */
export function stageForProgress(p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  const idx = Math.floor(clamped * JOURNEY_STAGES.length);
  return Math.min(JOURNEY_STAGES.length - 1, idx);
}

/** Blend camera across keys by progress (eased within each segment). */
export function journeyCamera(p: number): JourneyCamera {
  const clamped = Math.min(1, Math.max(0, p));
  const segments = JOURNEY_CAMERAS.length - 1;
  const raw = clamped * segments;
  const i = Math.min(segments - 1, Math.floor(raw));
  const t = easeInOutCubic(raw - i);
  const a = JOURNEY_CAMERAS[i];
  const b = JOURNEY_CAMERAS[i + 1];
  return {
    pos: { x: lerp(a.pos.x, b.pos.x, t), y: lerp(a.pos.y, b.pos.y, t), z: lerp(a.pos.z, b.pos.z, t) },
    look: { x: lerp(a.look.x, b.look.x, t), y: lerp(a.look.y, b.look.y, t), z: lerp(a.look.z, b.look.z, t) },
  };
}

/** Slow orbital drift for the cinematic feel (radians by elapsed seconds). */
export function journeyOrbitAngle(elapsedSec: number): number {
  return elapsedSec * 0.05;
}