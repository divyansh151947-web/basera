import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import {
  getClientIp,
  mediaApiLimiter,
  rateLimitedResponse,
} from "@/lib/rate-limit";
import { readStoredMedia } from "@/lib/media/storage";

export const runtime = "nodejs";

// ==========================================================================
// GET /api/media/properties/<organizationId>/<contentHash>.<ext>
//
// Public delivery for property images/videos (property media appears on
// anonymous listings). Safety:
//   - only the exact content-addressed path shape is served (path traversal
//     and arbitrary reads are impossible: org + filename are re-validated
//     against strict patterns and joined inside the storage root),
//   - no filesystem paths, credentials, or internal errors are exposed,
//   - immutable caching (names are content hashes) + nosniff,
//   - HTTP range requests so video seeking works without loading the whole
//     file into memory,
//   - per-IP rate limiting inherited from the project's abuse controls.
// ==========================================================================

function parseRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0) return "invalid";
  if (start >= size) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const ip = getClientIp(req.headers);
  const rl = await mediaApiLimiter.check(`media:${ip}`);
  if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

  const segments = Array.isArray(params.path) ? params.path : [];
  if (segments.length !== 3 || segments[0] !== "properties") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [, organizationId, filename] = segments;

  const file = await readStoredMedia(organizationId, filename);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const baseHeaders: Record<string, string> = {
    "Content-Type": file.contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };

  const range = parseRange(req.headers.get("range"), file.size);
  if (range === "invalid") {
    return new NextResponse(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${file.size}` },
    });
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : file.size - 1;

  if (req.method === "HEAD") {
    return new NextResponse(null, {
      status: 200,
      headers: { ...baseHeaders, "Content-Length": String(file.size) },
    });
  }

  const nodeStream = fs.createReadStream(file.path, { start, end });
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

  const headers: Record<string, string> = {
    ...baseHeaders,
    "Content-Length": String(end - start + 1),
  };
  if (range) {
    headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
  }

  return new NextResponse(webStream, {
    status: range ? 206 : 200,
    headers,
  });
}