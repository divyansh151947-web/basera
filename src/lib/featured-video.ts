// Property-driven selection for the homepage video showcase.
//
// The homepage used to play a static bundled demo reel regardless of what the
// business actually had published, which could advertise a property the
// workspace never listed. This module picks the featured video from the
// REAL published properties instead:
//
//   1. Locality priority — a property in the viewer's preferred locality
//      (set by the explore city/locality filters, stored in a cookie).
//   2. City priority — a property in the viewer's preferred city.
//   3. Deterministic fallback — the newest published property that has a
//      video (createdAt desc, then id asc so ties never flap between loads).
//
// If NO published property has a video, we return null and the homepage
// renders an honest empty state instead of a fabricated reel.
//
// This module is pure (no DB, no IO) so the ordering and tie-breaks are unit
// tested directly — see featured-video.test.ts.

export interface FeaturedVideoCandidate {
  id: string;
  /** Human-readable project name shown as the showcase title. */
  title: string;
  city: string;
  locality: string;
  /** Absolute media URL of the property video, or null/empty when absent. */
  videoUrl: string | null | undefined;
  /** Optional poster image URL for the video player. */
  videoPosterUrl?: string | null;
  /** ISO timestamp used for the deterministic newest-first ordering. */
  createdAt: string | null | undefined;
}

export interface FeaturedVideoPreference {
  city?: string | null;
  locality?: string | null;
}

/** Normalise a user/location string for comparison: trim, collapse spaces, casefold. */
function norm(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A candidate is eligible only when it has a real, non-empty video URL. */
export function hasVideo(candidate: Pick<FeaturedVideoCandidate, "videoUrl">): boolean {
  return typeof candidate.videoUrl === "string" && candidate.videoUrl.trim().length > 0;
}

/**
 * Deterministic ordering for the fallback tier: newest first, id ascending as
 * the tie-break so two properties created in the same second always resolve
 * to the same pick across requests and processes.
 */
export function compareForFallback(a: FeaturedVideoCandidate, b: FeaturedVideoCandidate): number {
  const at = Date.parse(a.createdAt ?? "") || 0;
  const bt = Date.parse(b.createdAt ?? "") || 0;
  if (bt !== at) return bt - at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pick the featured showcase video for the homepage.
 *
 * @param candidates Published properties (any of which may lack a video).
 * @param preference Optional viewer preference (city / locality cookies).
 * @returns The chosen candidate, or null when nothing with a video exists.
 */
export function pickFeaturedPropertyVideo<T extends FeaturedVideoCandidate>(
  candidates: readonly T[],
  preference: FeaturedVideoPreference = {}
): T | null {
  const withVideo = candidates.filter(hasVideo);
  if (withVideo.length === 0) return null;

  const city = norm(preference.city);
  const locality = norm(preference.locality);

  // Tier 1: preferred locality (most specific wins).
  if (locality) {
    const match = withVideo
      .filter((c) => norm(c.locality) === locality)
      .sort(compareForFallback)[0];
    if (match) return match;
  }

  // Tier 2: preferred city.
  if (city) {
    const match = withVideo
      .filter((c) => norm(c.city) === city)
      .sort(compareForFallback)[0];
    if (match) return match;
  }

  // Tier 3: deterministic newest-first fallback.
  return [...withVideo].sort(compareForFallback)[0];
}
