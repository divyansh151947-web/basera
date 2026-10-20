// Viewer location preference for the homepage video showcase.
//
// When a visitor filters explore by city (or opens a property's detail page),
// the browser remembers that city/locality in a first-party, non-identifying
// cookie. The homepage then prioritises a published property video from that
// locality, then that city, then falls back deterministically — see
// src/lib/featured-video.ts. No precise geolocation is used or requested;
// these are just the values the visitor themselves selected/browsed.
//
// The write side runs in the browser (document.cookie); the read side runs on
// the server (next/headers cookies()) in src/app/page.tsx.

export const PREF_CITY_COOKIE = "basera_pref_city";
export const PREF_LOCALITY_COOKIE = "basera_pref_locality";

/** 180 days — long enough to remember, short enough to expire stale taste. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

function writeCookie(name: string, value: string | null | undefined) {
  if (typeof document === "undefined") return;
  const trimmed = value?.trim();
  if (!trimmed) {
    // Clearing: expire the cookie immediately.
    document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
    return;
  }
  document.cookie = `${name}=${encodeURIComponent(trimmed)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * Remember the city/locality the visitor is currently browsing.
 * Empty strings / null clear the corresponding cookie (e.g. "All Cities").
 * Never throws — this is best-effort personalisation.
 */
export function rememberCityPreference(city: string | null | undefined) {
  try {
    writeCookie(PREF_CITY_COOKIE, city);
  } catch {
    // Cookie writes can be blocked (private mode, policy); ignore.
  }
}

export function rememberLocationPreference(
  city: string | null | undefined,
  locality: string | null | undefined
) {
  try {
    writeCookie(PREF_CITY_COOKIE, city);
    writeCookie(PREF_LOCALITY_COOKIE, locality);
  } catch {
    // Best-effort only.
  }
}
