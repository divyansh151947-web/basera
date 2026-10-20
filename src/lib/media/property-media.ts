import { z } from "zod";
import { isOwnedMediaUrl } from "./urls";

// ==========================================================================
// PROPERTY MEDIA — shared shape + URL policy (no node-only imports).
//
// The gallery is stored in the existing `properties.imagesJson` column as a
// plain JSON array of image URLs (first entry = cover). No schema change is
// needed for images/order/cover. The video reference lives in the additive
// `videoUrl` (and optional `videoPosterUrl`) columns.
// ==========================================================================

export const MAX_GALLERY_IMAGES = 30;
export const MAX_MEDIA_URL_LENGTH = 2048;

/** Parse `imagesJson` into a clean string[] — tolerant of corrupt/legacy data. */
export function parseImagesJson(imagesJson: unknown): string[] {
  if (typeof imagesJson !== "string") return [];
  try {
    const parsed = JSON.parse(imagesJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u): u is string => typeof u === "string" && u.length > 0 && u.length <= MAX_MEDIA_URL_LENGTH);
  } catch {
    return [];
  }
}

export function serializeImagesJson(urls: string[]): string {
  return JSON.stringify(urls);
}

/**
 * Is this URL acceptable as a stored image reference?
 * - our own content-addressed media URLs (`/api/media/properties/<org>/<file>`)
 * - absolute https URLs (legacy seeded/CDN images that already exist)
 * Everything else — javascript:, data:, http:, blob:, protocol-relative — is
 * rejected to keep stored media safe to render and to avoid mixed content.
 */
export function isAcceptableImageUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_MEDIA_URL_LENGTH) return false;
  if (url.startsWith("/api/media/properties/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate an entire desired gallery for a property: each entry must be a
 * URL this organization is allowed to reference. Entries that are our own
 * media URLs must belong to THIS organization; https entries are allowed but
 * only if they already existed in the property's stored gallery (so a caller
 * cannot inject arbitrary remote URLs, while legacy images keep working).
 */
export function validateGalleryUpdate(
  urls: unknown,
  organizationId: string,
  existingUrls: string[]
): { ok: true; images: string[] } | { ok: false; error: string } {
  if (!Array.isArray(urls)) return { ok: false, error: "images must be an array of URLs" };
  if (urls.length > MAX_GALLERY_IMAGES) {
    return { ok: false, error: `A property can have at most ${MAX_GALLERY_IMAGES} images.` };
  }
  const existing = new Set(existingUrls);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== "string") return { ok: false, error: "Each image must be a URL string." };
    const url = raw.trim();
    if (seen.has(url)) continue; // silently drop duplicates
    if (!isAcceptableImageUrl(url)) {
      return { ok: false, error: "One or more images use an unsupported URL." };
    }
    if (url.startsWith("/api/media/properties/")) {
      if (!isOwnedMediaUrl(url, organizationId)) {
        return { ok: false, error: "One or more images do not belong to this workspace." };
      }
    } else if (!existing.has(url)) {
      // A remote https URL may only be re-listed if it was already stored.
      return { ok: false, error: "One or more images are not recognized." };
    }
    seen.add(url);
    out.push(url);
  }
  return { ok: true, images: out };
}

export const galleryPatchSchema = z.object({
  images: z.array(z.string().max(MAX_MEDIA_URL_LENGTH)).max(MAX_GALLERY_IMAGES),
});

export const videoPatchSchema = z.object({
  url: z.string().max(MAX_MEDIA_URL_LENGTH).nullable(),
});