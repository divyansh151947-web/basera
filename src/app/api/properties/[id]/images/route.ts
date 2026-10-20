import { NextRequest, NextResponse } from "next/server";
import { requireRole, TenantAuthError } from "@/lib/tenant";
import { getPropertyById, updateProperty } from "@/lib/data/properties";
import { getClientIp, rateLimitedResponse, staffApiLimiter } from "@/lib/rate-limit";
import { saveMedia } from "@/lib/media/storage";
import { validateImageUpload } from "@/lib/media/validate";
import {
  MAX_GALLERY_IMAGES,
  galleryPatchSchema,
  parseImagesJson,
  serializeImagesJson,
  validateGalleryUpdate,
} from "@/lib/media/property-media";

// ==========================================================================
// /api/properties/[id]/images
//
// POST  — upload one or more images (multipart, fields "files"/"file"),
//         validated by real content, stored content-addressed, and APPENDED
//         to the property gallery (existing images are never dropped).
// PATCH — set the full gallery order (reorder / remove / choose cover) from
//         already-authorized URLs.
//
// RBAC: only BUSINESS_ADMIN / MANAGER (same roles as property create/edit).
// Tenancy: the property is resolved through the caller's organization, so a
// foreign property id yields 404 and never reveals another tenant's media.
// ==========================================================================

const MAX_FILES_PER_REQUEST = 15;

function handleError(err: unknown) {
  if (err instanceof TenantAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("[property images] error:", err instanceof Error ? err.message : "unknown");
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

    const collected: File[] = [];
    for (const key of ["files", "file"]) {
      for (const value of form.getAll(key)) {
        if (typeof value === "object" && value !== null && "arrayBuffer" in value && "size" in value) {
          collected.push(value as File);
        }
      }
    }
    if (collected.length === 0) {
      return NextResponse.json({ error: "No image files were provided." }, { status: 400 });
    }
    if (collected.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json({ error: `Upload at most ${MAX_FILES_PER_REQUEST} images at a time.` }, { status: 400 });
    }

    const existing = parseImagesJson(property.imagesJson);
    const uploaded: string[] = [];
    const rejected: Array<{ name: string; reason: string }> = [];

    let slots = MAX_GALLERY_IMAGES - existing.length;
    for (const file of collected) {
      const name = file.name || "image";
      if (slots <= 0) {
        rejected.push({ name, reason: `Gallery is limited to ${MAX_GALLERY_IMAGES} images.` });
        continue;
      }
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const check = validateImageUpload({ name, type: file.type, size: file.size, head });
      if (!check.ok) {
        rejected.push({ name, reason: check.error });
        continue;
      }
      const body = new Uint8Array(await file.arrayBuffer());
      const saved = await saveMedia(organizationId, body, check.ext);
      uploaded.push(saved.url);
      slots -= 1;
    }

    if (uploaded.length === 0) {
      return NextResponse.json({ error: "No valid images were uploaded.", rejected }, { status: 400 });
    }

    const finalImages = Array.from(new Set([...existing, ...uploaded])).slice(0, MAX_GALLERY_IMAGES);
    const updated = await updateProperty(organizationId, params.id, {
      imagesJson: serializeImagesJson(finalImages),
    } as any);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ images: finalImages, uploaded, rejected }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { organizationId, userId } = await requireRole(["BUSINESS_ADMIN", "MANAGER"]);
    const rl = await staffApiLimiter.check(`staff-api:${userId}:${getClientIp(req.headers)}`);
    if (!rl.allowed) return rateLimitedResponse(rl.retryAfterMs);

    const property = await getPropertyById(organizationId, params.id);
    if (!property) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const parsed = galleryPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid gallery payload" }, { status: 400 });
    }

    const existing = parseImagesJson(property.imagesJson);
    const validated = validateGalleryUpdate(parsed.data.images, organizationId, existing);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

    const updated = await updateProperty(organizationId, params.id, {
      imagesJson: serializeImagesJson(validated.images),
    } as any);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ images: validated.images });
  } catch (err) {
    return handleError(err);
  }
}