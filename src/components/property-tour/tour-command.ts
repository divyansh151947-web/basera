import type { TourLocationId } from "./tour-types";

/**
 * Tour command router: natural-language room navigation (English + Hindi/
 * Hinglish keywords) plus question detection. Pure and unit-tested.
 * Navigation resolves locally; free-form questions are forwarded by the
 * shell to the existing voice-session API (same Basera brain, org-scoped).
 */

export type TourCommand = { kind: "goto"; target: TourLocationId } | { kind: "question"; text: string };

const NAV_KEYWORDS: { target: TourLocationId; patterns: RegExp[] }[] = [
  {
    target: "exterior",
    patterns: [/exterior/i, /\boutside\b/i, /\bfront\b/i, /facade/i, /elevation/i, /bahar/i, /बाहर/i],
  },
  {
    target: "living",
    patterns: [/living(\s|-)room/i, /lounge/i, /living/i, /\bhall\b/i, /लिविंग/i, /बैठक/i, /drawing\s?room/i],
  },
  {
    target: "kitchen",
    patterns: [/kitchen/i, /रसोई/i, /khana\b/i, /rasoi/i],
  },
  {
    target: "bedroom",
    patterns: [/bedroom/i, /bed\s?room/i, /\bbed\b/i, /शयन/i, /बेडरूम/i, /kamra/i, /kamre/i, /sleep/i],
  },
  {
    target: "bathroom",
    patterns: [/bathroom/i, /bath\s?room/i, /\bbath\b/i, /washroom/i, /toilet/i, /snan/i, /स्नान/i, /बाथरूम/i, /shower/i],
  },
  {
    target: "balcony",
    patterns: [/balcon/i, /gallery/i, /बालकनी/i, /baranda/i, /veranda/i],
  },
  {
    target: "pool",
    patterns: [/swimming\s?pool/i, /\bpool\b/i, /swim/i, /पूल/i, /talab/i, /pokhar/i],
  },
  {
    target: "garden",
    patterns: [/garden/i, /lawn/i, /bagh/i, /angan|aangan/i, /बाग/i, /बगीचा/i, /bagicha/i, /park\b/i, /plants/i, /greenery/i],
  },
  {
    target: "parking",
    patterns: [/parking/i, /garage/i, /पार्किंग/i, /gaadi/i, /car\b/i],
  },
  {
    target: "terrace",
    patterns: [/terrace/i, /deck/i, /chhat/i, /छत/i, /terace/i],
  },
  {
    target: "rooftop",
    patterns: [/rooftop/i, /roof\b/i, /top\s?floor/i, /mumty/i],
  },
];

const SHOW_VERBS = /show|take|go|le\s?chal|dikha|dekha|chalo|batao\s*(kaha|kahan)?|le\s*jaiye/i;

function mentionsPlace(text: string): TourLocationId | null {
  for (const entry of NAV_KEYWORDS) {
    if (entry.patterns.some((re) => re.test(text))) return entry.target;
  }
  return null;
}

/**
 * Route a tour command. Explicit navigation ("show me X", "X dikhao",
 * bare room names, floor/building requests map to tower) wins; everything
 * else is a question for the existing AI pipeline.
 */
export function routeTourCommand(rawText: string): TourCommand {
  const text = (rawText ?? "").trim();
  if (!text) return { kind: "question", text: "" };
  // Tower/building/city requests (but not explicit rooftop phrases like "top floor" / "rooftop").
  if (!/rooftop|top\s?floor|\broof\b/i.test(text) && /tower|building|floor|city|3d\s?tour|penthouse|manjil|मंजिल/i.test(text)) {
    return { kind: "goto", target: "tower" };
  }
  const place = mentionsPlace(text);
  if (place && (SHOW_VERBS.test(text) || /^\s*\S+(\s+\S+){0,3}\s*$/.test(text.replace(/[?.!,]/g, "")))) {
    return { kind: "goto", target: place };
  }
  if (place && /kaha|kahan|where|कहाँ|kahaan/i.test(text)) {
    return { kind: "goto", target: place };
  }
  return { kind: "question", text };
}
