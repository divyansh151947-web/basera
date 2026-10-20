import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  MEDIA_CONTENT_TYPES,
  SAFE_ORG_ID,
  SAFE_MEDIA_FILENAME,
  mediaUrlFor,
  parseOwnedMediaUrl,
} from "./urls";

// ==========================================================================
// PROPERTY MEDIA — STORAGE PROVIDER (server-only)
//
// There is no object-storage SDK in this project, so the smallest safe,
// configurable provider is a LOCAL DISK driver:
//
//   MEDIA_STORAGE_DIR=/absolute/persistent/path   (production: a mounted volume)
//   unset / relative                              (dev: <cwd>/.uploads)
//
// IMPORTANT DEPLOYMENT NOTE: local disk is NOT production-persistent on
// ephemeral/serverless hosts. On a single long-lived Node server with a
// persistent volume it works and is what this build ships. True object
// storage (S3/R2/GCS) is intentionally NOT configured here — see
// docs/PROPERTY_MEDIA.md — so a production deployment that needs ephemeral
// compute must supply one (out of scope for this change).
//
// Files are CONTENT-ADDRESSED: the on-disk name is the SHA-256 of the bytes,
// never the user's filename. This makes storage names safe, de-duplicates
// identical uploads, and lets media be served with immutable caching.
// ==========================================================================

const SAFE_ORG = SAFE_ORG_ID;
const SAFE_FILE = SAFE_MEDIA_FILENAME;

/** Absolute root directory currently used for media storage. */
export function getMediaRoot(): string {
  const configured = process.env.MEDIA_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), ".uploads");
}

/** True when a non-local (object storage) driver is configured. */
export function isObjectStorageConfigured(): boolean {
  return false;
}

export function storageDriverName(): "local-disk" | "object-storage" {
  return isObjectStorageConfigured() ? "object-storage" : "local-disk";
}

function dirForOrganization(organizationId: string): string {
  if (!SAFE_ORG.test(organizationId)) throw new Error("Invalid organization id for media storage");
  const root = getMediaRoot();
  const dir = path.join(root, "properties", organizationId);
  // Defense-in-depth: the resolved path must stay inside the media root.
  const resolved = path.resolve(dir);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error("Media path escapes the storage root");
  }
  return resolved;
}

/** Resolve an on-disk path for an already-validated org + filename. */
export function resolveStoredFilePath(organizationId: string, filename: string): string | null {
  if (!SAFE_ORG.test(organizationId) || !SAFE_FILE.test(filename)) return null;
  let dir: string;
  try {
    dir = dirForOrganization(organizationId);
  } catch {
    return null;
  }
  return path.join(dir, filename);
}

export interface SavedMedia {
  url: string;
  filename: string;
  bytes: number;
}

/**
 * Persist bytes under a content-addressed name and return its public URL.
 * Idempotent: identical bytes overwrite the same file (no-op if present).
 */
export async function saveMedia(organizationId: string, data: Uint8Array, ext: string): Promise<SavedMedia> {
  const dir = dirForOrganization(organizationId);
  await fsp.mkdir(dir, { recursive: true });
  const filename = `${createHash("sha256").update(data).digest("hex")}.${ext}`;
  const fullPath = path.join(dir, filename);
  try {
    await fsp.access(fullPath, fs.constants.F_OK);
    // Already stored (identical bytes) — reuse.
  } catch {
    await fsp.writeFile(fullPath, data, { flag: "wx" }).catch(async (err: NodeJS.ErrnoException) => {
      // Another concurrent writer may have created it first; that is fine.
      if (err?.code !== "EEXIST") throw err;
    });
  }
  return { url: mediaUrlFor(organizationId, filename), filename, bytes: data.byteLength };
}

export interface StoredMediaFile {
  path: string;
  size: number;
  contentType: string;
}

/**
 * Persist a streamed upload under a content-addressed name WITHOUT buffering
 * the whole file in memory: bytes flow through a SHA-256 hasher into a temp
 * file, which is then renamed to `<hash>.<ext>`. Aborts (and removes the temp
 * file) when `maxBytes` is exceeded. Idempotent for identical content.
 */
export async function saveMediaFromStream(
  organizationId: string,
  stream: ReadableStream<Uint8Array>,
  ext: string,
  maxBytes: number
): Promise<SavedMedia> {
  const dir = dirForOrganization(organizationId);
  await fsp.mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${createHash("sha1").update(String(Date.now())).digest("hex")}-${Math.random().toString(16).slice(2)}`);
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        cb(new Error("MEDIA_TOO_LARGE"));
        return;
      }
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(stream as never), meter, fs.createWriteStream(tmpPath));
  } catch (err) {
    await fsp.rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
  const filename = `${hash.digest("hex")}.${ext}`;
  const fullPath = path.join(dir, filename);
  try {
    await fsp.access(fullPath, fs.constants.F_OK);
    await fsp.rm(tmpPath, { force: true }); // identical content already stored
  } catch {
    await fsp.rename(tmpPath, fullPath);
  }
  return { url: mediaUrlFor(organizationId, filename), filename, bytes };
}

/** Look up a stored media file by org + filename. Returns null when absent. */
export async function readStoredMedia(organizationId: string, filename: string): Promise<StoredMediaFile | null> {
  const fullPath = resolveStoredFilePath(organizationId, filename);
  if (!fullPath) return null;
  try {
    const stat = await fsp.stat(fullPath);
    if (!stat.isFile()) return null;
    const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
    return { path: fullPath, size: stat.size, contentType: MEDIA_CONTENT_TYPES[ext] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

/** Best-effort delete of a single stored file by org + filename. */
export async function deleteStoredMedia(organizationId: string, filename: string): Promise<boolean> {
  const fullPath = resolveStoredFilePath(organizationId, filename);
  if (!fullPath) return false;
  try {
    await fsp.unlink(fullPath);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort delete by a media URL we produced. Silently ignores others. */
export async function deleteMediaByUrl(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  const parsed = parseOwnedMediaUrl(url);
  if (!parsed) return false;
  return deleteStoredMedia(parsed.organizationId, parsed.filename);
}

/**
 * Remove abandoned files: on-disk media older than `maxAgeMs` that no
 * property currently references. NEVER touches referenced files. Scoped to
 * the storage root; tolerates a missing root. Returns the number removed.
 */
export async function cleanupAbandonedMedia(
  referencedUrls: Iterable<string>,
  maxAgeMs = 24 * 60 * 60 * 1000
): Promise<number> {
  const referenced = new Set<string>();
  for (const url of Array.from(referencedUrls)) {
    const parsed = parseOwnedMediaUrl(url);
    if (parsed) referenced.add(`${parsed.organizationId}/${parsed.filename}`);
  }

  const root = path.join(getMediaRoot(), "properties");
  let orgDirs: string[] = [];
  try {
    orgDirs = await fsp.readdir(root);
  } catch {
    return 0; // nothing stored yet
  }

  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;
  for (const orgDir of orgDirs) {
    if (!SAFE_ORG.test(orgDir)) continue;
    const orgPath = path.join(root, orgDir);
    let files: string[] = [];
    try {
      files = await fsp.readdir(orgPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!SAFE_FILE.test(file)) continue;
      if (referenced.has(`${orgDir}/${file}`)) continue;
      const filePath = path.join(orgPath, file);
      try {
        const stat = await fsp.stat(filePath);
        if (!stat.isFile() || stat.mtimeMs > cutoff) continue;
        await fsp.unlink(filePath);
        removed += 1;
      } catch {
        // best-effort: never fail a cleanup on one file
      }
    }
  }
  return removed;
}