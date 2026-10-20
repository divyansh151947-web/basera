import { routeTourCommand } from "@/components/property-tour/tour-command";
import type { TourLocationId } from "@/components/property-tour/tour-types";
import type { DetectedVoiceLanguage } from "./voice-language";

/**
 * VOICE NAVIGATION ACTION LAYER (additive, deterministic, unit-tested).
 *
 * Maps spoken/typed commands to SAFE actions only:
 *  - app navigation: a fixed allowlist of REAL dashboard routes (verified
 *    against src/app). The model can NEVER emit an arbitrary URL — unknown
 *    destinations resolve to null and fall through to the AI pipeline.
 *  - 3D tour navigation: reuses the existing tour-command router
 *    (EN/HI/Hinglish room keywords); executed client-side via a CustomEvent
 *    the PropertyTour shell listens for. No 3D system is rebuilt here.
 *  - destructive intents ("delete this lead"): NEVER executed — they resolve
 *    to a confirmation action the UI speaks and waits on.
 *  - browser back ("go back"): executed client-side via history.back().
 *
 * Property-search queries ("3 BHK properties under 80 lakh", "properties
 * with a pool") are explicitly NOT navigation — they belong to the AI
 * qualification/matching pipeline and return null here.
 */

export const VOICE_TOUR_EVENT = "basera:voice-navigate";

export type VoiceAppAction =
  | "dashboard"
  | "leads"
  | "properties"
  | "conversations"
  | "voice"
  | "appointments"
  | "recovery"
  | "analytics"
  | "settings"
  | "team"
  | "tour"
  | "home";

export interface VoiceActionRoute {
  route: string;
  section: string;
}

/** Fixed allowlist — every route verified in src/app. No dynamic URLs, ever. */
export const VOICE_ACTIONS: Record<VoiceAppAction, VoiceActionRoute> = {
  dashboard: { route: "/dashboard", section: "Dashboard" },
  leads: { route: "/leads", section: "Leads" },
  properties: { route: "/properties", section: "Properties" },
  conversations: { route: "/conversations", section: "Conversations" },
  voice: { route: "/voice", section: "Voice AI" },
  appointments: { route: "/appointments", section: "Appointments" },
  recovery: { route: "/recovery", section: "Revenue Recovery" },
  analytics: { route: "/analytics", section: "Analytics" },
  settings: { route: "/settings", section: "Settings" },
  team: { route: "/team", section: "Sales team" },
  tour: { route: "/tour", section: "3D property tour" },
  home: { route: "/", section: "home" },
};

export type VoiceClientAction =
  | { kind: "navigate"; action: VoiceAppAction; to: string; section: string }
  | { kind: "tour"; target: TourLocationId; room: string }
  | { kind: "confirm"; confirm: "delete-lead" }
  | { kind: "back" };

export type VoiceDetectedAction =
  | VoiceClientAction
  | { kind: "none" };

const NAV_VERBS = /open|kholo|kholiye|khol|show|take me|go to|go\b|le chal|chalo|dikhao|dikha|dikhaiye|dekhao|chahiye dekhna|खोलो|दिखाओ|दिखाइए|चलो|जाओ/i;

const APP_PATTERNS: { action: VoiceAppAction; patterns: RegExp[] }[] = [
  { action: "dashboard", patterns: [/dashboard/i, /डैशबोर्ड/] },
  {
    action: "leads",
    patterns: [/\bleads?\b/i, /lead\s*list/i, /my leads/i, /लीड्स?/],
  },
  {
    action: "properties",
    patterns: [/\bproperties\b/i, /property\s*list/i, /\blistings?\b/i, /प्रॉपर्टी/],
  },
  {
    action: "conversations",
    patterns: [/\bconversations?\b/i, /\bchats?\b/i, /baatcheet/i, /baat\s*cheet/i, /बातचीत/],
  },
  {
    action: "voice",
    patterns: [/\bvoice(\s*assistant|\s*ai)?\b/i, /\bmic\b/i, /\bai\b/i, /awaz/i, /आवाज़/, /आवाज/],
  },
  {
    action: "appointments",
    patterns: [/\bappointments?\b/i, /site visits?\b/i, /अपॉइंटमेंट/],
  },
  {
    action: "recovery",
    patterns: [/\brecovery\b/i, /रिकवरी/],
  },
  {
    action: "analytics",
    patterns: [/\banalytics\b/i, /revenue intelligence/i, /\breports?\b/i],
  },
  {
    action: "settings",
    patterns: [/\bsettings?\b/i, /सेटिंग/],
  },
  {
    action: "team",
    patterns: [/\b(sales\s*)?team\b/i, /agents?\s*list/i, /टीम/],
  },
  {
    action: "tour",
    patterns: [/\b3d\s*tour\b/i, /property\s*tour/i, /virtual\s*tour/i, /\btour\b.*\b3d\b/i],
  },
  {
    action: "home",
    patterns: [/\bhomepage\b/i, /\bgo home\b/i, /\bhome\s?page\b/i],
  },
];

/** Nouns that mark a PROPERTY SEARCH (AI pipeline), never navigation. */
const PROPERTY_SEARCH_RE =
  /\bpropert(y|ies)\b.*\b(bhk|budget|lakh|crore|buy|rent|cheap|premium|matching|city|locality|under|over|between|with|looking|need|want|find|search)\b|\b(bhk|budget|lakh|crore)\b.*\bpropert(y|ies)\b|\bswimming pool\b.*\bpropert|\bpropert.*\bswimming pool\b/i;

const DESTRUCTIVE_VERBS = "delete|remove|erase|discard|hatao|hata\\s+do|mitao|mita\\s+do|डिलीट|हटाओ|मिटाओ";
const DESTRUCTIVE_RE = new RegExp(
  `\\b(?:${DESTRUCTIVE_VERBS})\\b.*\\bleads?\\b|\\bleads?\\b.*\\b(?:${DESTRUCTIVE_VERBS})\\b|लीड.*(?:हटाओ|मिटाओ|डिलीट)|(?:हटाओ|मिटाओ|डिलीट).*लीड`,
  "i"
);

const BACK_RE = /^\s*(go back|back jao|wapas(?: chalo| jao)?|पीछे|वापस)\s*[?.!]*\s*$/i;

function mentionsAppTarget(text: string): VoiceAppAction | null {
  for (const entry of APP_PATTERNS) {
    if (entry.patterns.some((re) => re.test(text))) return entry.action;
  }
  return null;
}

/**
 * Detect a safe voice action. Returns {kind:'none'} when the text is
 * conversational, a property search, or unrecognized — the AI pipeline
 * handles those. Pure and fully unit-tested.
 */
export function detectVoiceAction(rawText: string): VoiceDetectedAction {
  const text = (rawText ?? "").trim();
  if (!text) return { kind: "none" };

  if (DESTRUCTIVE_RE.test(text)) return { kind: "confirm", confirm: "delete-lead" };
  if (BACK_RE.test(text)) return { kind: "back" };

  // 3D tour rooms (EN/HI/Hinglish via the existing router, tower included
  // for the building/city view), but never when the sentence is really a
  // property search for the AI pipeline.
  if (!PROPERTY_SEARCH_RE.test(text)) {
    try {
      const routed = routeTourCommand(text);
      if (routed.kind === "goto") {
        return { kind: "tour", target: routed.target, room: routed.target };
      }
    } catch {
      // Router is best-effort; fall through to app intents below.
    }
  }

  const app = mentionsAppTarget(text);
  if (app && NAV_VERBS.test(text)) {
    // "Show me 3 BHK properties" / "properties with a pool" are property
    // searches for the AI pipeline — never the Properties page.
    if (app === "properties" && PROPERTY_SEARCH_RE.test(text)) return { kind: "none" };
    const def = VOICE_ACTIONS[app];
    return { kind: "navigate", action: app, to: def.route, section: def.section };
  }

  return { kind: "none" };
}

/** Short localized confirmation spoken alongside (never instead of) navigation. */
export function voiceActionConfirmation(action: VoiceDetectedAction, language: DetectedVoiceLanguage): string | null {
  if (action.kind === "navigate") {
    if (language === "hi") return `${action.section} khol raha hoon.`;
    if (language === "hinglish") return `${action.section} open kar raha hoon.`;
    return `Opening ${action.section}.`;
  }
  if (action.kind === "tour") {
    if (language === "hi") return `${action.room} dikha raha hoon.`;
    if (language === "hinglish") return `${action.room} dikha raha hoon.`;
    return `Showing you the ${action.room}.`;
  }
  if (action.kind === "back") {
    if (language === "hi") return "Wapas ja raha hoon.";
    if (language === "hinglish") return "Back ja raha hoon.";
    return "Going back.";
  }
  if (action.kind === "confirm") {
    if (language === "hi")
      return "Lead delete karna permanent hai. Kya aap chahte hain ki main aage badhun? Haan ya na mein jawab dein.";
    if (language === "hinglish")
      return "Lead delete karna permanent hai. Kya main continue karoon? Haan ya na mein batao.";
    return "Deleting a lead is permanent. Do you want me to continue? Please answer yes or no.";
  }
  return null;
}

/** True for short explicit confirmations that complete a pending confirm. */
export function isVoiceConfirmationYes(text: string): boolean {
  return /^\s*(yes|yeah|yep|sure|ok(?:ay)?|haan|han|ha|bilkul|zaroor|करो|हाँ)\s*[?.!]*\s*$/i.test((text ?? "").trim());
}

/** Narrow an arbitrary string to a known tour target (guards event payloads). */
export function isKnownTourTarget(value: unknown): value is TourLocationId {
  return (
    value === "door" || value === "entrance" || value === "exterior" ||
    value === "living" || value === "kitchen" || value === "bedroom" ||
    value === "bathroom" || value === "balcony" || value === "pool" ||
    value === "garden" || value === "parking" || value === "terrace" ||
    value === "rooftop" || value === "tower"
  );
}
