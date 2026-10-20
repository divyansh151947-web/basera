import { NextRequest, NextResponse } from "next/server";
import { requireRole, TenantAuthError } from "@/lib/tenant";
import { getPropertyById, updateProperty } from "@/lib/data/properties";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import { deleteMediaByUrl, saveMediaFromStream } from "@/lib/media/storage";
import { maxVideoBytes, validateVideoUpload } from "@/lib/media/validate";

// ==========================================================================
// /api/properties/[id]/video
//
// POST   — upload/replace the property video (multipart field "file"). The
//          bytes are streamed to storage (never fully buffered) under a
//          content-addressed name; the previous file is cleaned up.
// DELETE — remove the property video and best-effort delete its stored file.
//
// RBAC: BUSINESS_ADMIN / MANAGER only. Tenancy: the property is resolved
// through the caller's organization, so foreign ids 404.
// ==========================================================================

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof Error && err.message === "MEDIA_TOO_LARGE") {
    return NextResponse.json({ error: "Video exceeds the configured size limit." }, { status: 413 });
  }
  console.error("[property video] error:", err instanceof Error ? err.message : "unknown");
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, userId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const property = await getPropertyById(organizationId, params.id);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Expected multipart/form-data upload." }, { status: 400 });
    }
    const value = form.get("file") ?? form.get("files");
    const file = value && typeof value === "object" && "arrayBuffer" in value && "size" in value ? (value as File) : null;
    if (!file) return NextResponse.json({ error: "No video file was provided." }, { status: 400 });

    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const check = validateVideoUpload({ name: file.name, type: file.type, size: file.size, head });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    const saved = await saveMediaFromStream(organizationId, file.stream(), check.ext, maxVideoBytes());

    const previousUrl = (property as { videoUrl?: string | null }).videoUrl ?? null;
    const updated = await updateProperty(organizationId, params.id, { videoUrl: saved.url } as any);
    if (!updated) {
      await deleteMediaByUrl(saved.url);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Replace semantics: drop the previous file once the new one is recorded.
    if (previousUrl && previousUrl !== saved.url) {
      await deleteMediaByUrl(previousUrl);
    }

    return NextResponse.json({ videoUrl: saved.url, bytes: saved.bytes }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, userId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const property = await getPropertyById(organizationId, params.id);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const previousUrl = (property as { videoUrl?: string | null }).videoUrl ?? null;
    const updated = await updateProperty(organizationId, params.id, {
      videoUrl: null,
      videoPosterUrl: null,
    } as any);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (previousUrl) await deleteMediaByUrl(previousUrl);

    return NextResponse.json({ videoUrl: null });
  } catch (err) {
    return handleError(err);
  }
}