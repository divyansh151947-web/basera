// ==========================================================================
// PROPERTY MEDIA — URL helpers (isomorphic, no node-only imports).
//
// A single source of truth for the media URL shape used by the storage
// provider, the API routes, the serving route, and validation. Kept free of
// node/server-only imports so it can be unit-tested and reused freely.
// ==========================================================================

export const MEDIA_URL_PREFIX = "/api/media";

export const SAFE_ORG_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const SAFE_MEDIA_FILENAME = /^[a-f0-9]{64}\.(jpg|png|webp|mp4)$/;

export const MEDIA_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
};

export function mediaUrlFor(organizationId: string, filename: string): string {
  return `${MEDIA_URL_PREFIX}/properties/${encodeURIComponent(organizationId)}/${encodeURIComponent(filename)}`;
}

/** Parse a URL produced by mediaUrlFor. Returns null for anything else. */
export function parseOwnedMediaUrl(url: string): { organizationId: string; filename: string } | null {
  if (typeof url !== "string" || !url.startsWith(`${MEDIA_URL_PREFIX}/properties/`)) return null;
  const rest = url.slice(`${MEDIA_URL_PREFIX}/properties/`.length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  let organizationId: string;
  let filename: string;
  try {
    organizationId = decodeURIComponent(parts[0]);
    filename = decodeURIComponent(parts[1]);
  } catch {
    return null;
  }
  if (!SAFE_ORG_ID.test(organizationId) || !SAFE_MEDIA_FILENAME.test(filename)) return null;
  return { organizationId, filename };
}

/** True when `url` is a media URL owned by the given organization. */
export function isOwnedMediaUrl(url: string, organizationId: string): boolean {
  const parsed = parseOwnedMediaUrl(url);
  return parsed !== null && parsed.organizationId === organizationId;
}