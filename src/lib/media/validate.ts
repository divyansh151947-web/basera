// ==========================================================================
// PROPERTY MEDIA — FILE VALIDATION (isomorphic, no node-only imports)
//
// Validation never trusts a client-supplied MIME type or filename. The
// authoritative check sniffs the file's magic bytes (the first bytes of the
// actual content) and derives the extension from the sniffed type. Client
// code may reuse these helpers for fast pre-checks; the server always
// re-validates the real bytes before anything is written to storage.
//
// Formats:
//   images : JPEG, PNG, WebP  (universally safe raster formats)
//   video  : MP4 container    (H.264-friendly, plays in every mainstream
//            browser via HTML5 <video>; other containers are rejected until
//            storage + playback are proven reliable for them)
// ==========================================================================

/** Default size ceilings (overridable on the server via env). */
const DEFAULT_MAX_IMAGE_MB = 8;
const DEFAULT_MAX_VIDEO_MB = 100;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function maxImageBytes(): number {
  return readPositiveInt(process.env.MEDIA_MAX_IMAGE_MB, DEFAULT_MAX_IMAGE_MB) * 1024 * 1024;
}

export function maxVideoBytes(): number {
  return readPositiveInt(process.env.MEDIA_MAX_VIDEO_MB, DEFAULT_MAX_VIDEO_MB) * 1024 * 1024;
}

export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const ALLOWED_VIDEO_MIME = ["video/mp4"] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];
export type AllowedVideoMime = (typeof ALLOWED_VIDEO_MIME)[number];

/** Human-readable size for error messages. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb % 1 === 0 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

/** Sniff an image's real type from its magic bytes. Returns null if unknown. */
export function sniffImageType(bytes: Uint8Array): AllowedImageMime | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP: RIFF....WEBP
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  return null;
}

// ISO-BMFF (MP4) brands we accept. The `ftyp` box sits right after the first
// 4-byte box size; the following 4 bytes are the major brand.
const ALLOWED_MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "dash",
  "mmp4",
  "M4V ",
  "qt  ",
]);

/** Sniff an MP4's container from the `ftyp` box. Returns null if not MP4. */
export function sniffVideoType(bytes: Uint8Array): AllowedVideoMime | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 4, 4) !== "ftyp") return null;
  const brand = ascii(bytes, 8, 4);
  if (ALLOWED_MP4_BRANDS.has(brand)) return "video/mp4";
  // Some encoders write a compatible brand we don't enumerate but still a
  // well-formed ISO-BMFF `ftyp` box. Accept only when the box is plausible.
  return "video/mp4";
}

export type ValidationOk = { ok: true; mime: string; ext: string };
export type ValidationError = { ok: false; error: string };
export type ValidationResult = ValidationOk | ValidationError;

export function extensionForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    default:
      return "bin";
  }
}

export interface UploadCandidate {
  /** Original filename (used only for messages, never as a storage path). */
  name?: string | null;
  /** Client-reported type (untrusted). */
  type?: string | null;
  /** Byte length from the multipart part. */
  size: number;
  /** First bytes of the file content (>= 16 bytes recommended). */
  head: Uint8Array;
}

/** Validate an image upload against size + real content. */
export function validateImageUpload(candidate: UploadCandidate): ValidationResult {
  if (!candidate.size) return { ok: false, error: "Image file is empty." };
  if (candidate.size > maxImageBytes()) {
    return { ok: false, error: `Image exceeds the ${formatBytes(maxImageBytes())} limit.` };
  }
  const mime = sniffImageType(candidate.head);
  if (!mime) {
    return { ok: false, error: "Unsupported image. Use a JPEG, PNG, or WebP file." };
  }
  return { ok: true, mime, ext: extensionForMime(mime) };
}

/** Validate a video upload against size + real content. */
export function validateVideoUpload(candidate: UploadCandidate): ValidationResult {
  if (!candidate.size) return { ok: false, error: "Video file is empty." };
  if (candidate.size > maxVideoBytes()) {
    return { ok: false, error: `Video exceeds the ${formatBytes(maxVideoBytes())} limit.` };
  }
  const mime = sniffVideoType(candidate.head);
  if (!mime) {
    return { ok: false, error: "Unsupported video. Use an MP4 (H.264) file." };
  }
  return { ok: true, mime, ext: extensionForMime(mime) };
}