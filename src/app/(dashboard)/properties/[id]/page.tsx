import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { getPropertyById } from "@/lib/data/properties";
import { formatInr } from "@/lib/formatters";
import { Pencil } from "lucide-react";

export default async function PropertyDetailPage({ params }: { params: { id: string } }) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;

  const property = await getPropertyById(organizationId, params.id);
  if (!property) notFound();

  const amenities: string[] = (() => {
    try {
      const parsed = JSON.parse(property.amenitiesJson ?? "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  const images: string[] = (() => {
    try {
      const parsed = JSON.parse(property.imagesJson ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((u: unknown) => typeof u === "string") : [];
    } catch {
      return [];
    }
  })();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/properties" className="text-sm font-medium text-brand hover:underline">
          ← All properties
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-ink">{property.projectName}</h1>
            <p className="mt-1 text-sm text-slate">
              {property.locality}, {property.city}
              {property.developer ? ` · by ${property.developer}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/properties/${params.id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium text-ink hover:bg-panel-soft transition"
            >
              <Pencil size={14} />
              Edit
            </Link>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                property.availability === "AVAILABLE"
                  ? "border-success/20 bg-success-soft text-success"
                  : property.availability === "SOLD_OUT"
                    ? "border-danger/20 bg-danger-soft text-danger"
                    : "border-warning/20 bg-warning-soft text-warning"
              }`}
            >
              {property.availability?.replace("_", " ")}
            </span>
          </div>
        </div>
      </div>

      {/* Media Section */}
      {images.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-ink">Images</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {images.map((url, idx) => (
              <div key={url} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-line bg-panel-soft">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Property image ${idx + 1}`} className="h-full w-full object-cover" />
                {idx === 0 && (
                  <span className="absolute top-1 left-1 rounded bg-brand/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    Cover
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {property.videoUrl && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-ink">Video</h2>
          <div className="rounded-lg overflow-hidden border border-line bg-black">
            <video
              className="w-full aspect-video"
              controls
              playsInline
              preload="metadata"
              poster={property.videoPosterUrl ?? undefined}
            >
              <source src={property.videoUrl} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="panel-surface p-5 text-sm">
          <h2 className="text-sm font-semibold text-ink">Price & size</h2>
          <dl className="mt-3 space-y-2">
            <div className="flex justify-between gap-2"><dt className="text-slate">Price range</dt><dd className="font-semibold text-brand">{formatInr(property.priceMinInr)} – {formatInr(property.priceMaxInr)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate">Type</dt><dd className="font-medium">{property.propertyType}{property.bhk ? ` · ${property.bhk} BHK` : ""}</dd></div>
            {property.areaSqft ? <div className="flex justify-between gap-2"><dt className="text-slate">Area</dt><dd className="font-medium">{property.areaSqft.toLocaleString("en-IN")} sqft</dd></div> : null}
            {property.furnishing ? <div className="flex justify-between gap-2"><dt className="text-slate">Furnishing</dt><dd className="font-medium">{property.furnishing.replace("_", " ").toLowerCase()}</dd></div> : null}
            {property.possessionDate ? <div className="flex justify-between gap-2"><dt className="text-slate">Possession</dt><dd className="font-medium">{property.possessionDate}</dd></div> : null}
            {property.floor ? <div className="flex justify-between gap-2"><dt className="text-slate">Floor</dt><dd className="font-medium">{property.floor}</dd></div> : null}
          </dl>
        </div>

        <div className="panel-surface p-5 text-sm">
          <h2 className="text-sm font-semibold text-ink">Location</h2>
          <dl className="mt-3 space-y-2">
            <div className="flex justify-between gap-2"><dt className="text-slate">City</dt><dd className="font-medium">{property.city}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate">Locality</dt><dd className="font-medium">{property.locality}</dd></div>
            {property.address ? <div className="flex justify-between gap-2"><dt className="text-slate">Address</dt><dd className="text-right font-medium">{property.address}</dd></div> : null}
          </dl>
          {property.description && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate">About</p>
              <p className="mt-2 leading-6 text-ink">{property.description}</p>
            </div>
          )}
        </div>
      </div>

      {amenities.length > 0 && (
        <div className="panel-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Amenities</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {amenities.map((a) => (
              <span key={a} className="chip">{a}</span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate">
        Availability and price are edited from the Properties list via the property API. Archived or sold-out units are never recommended by the AI.
      </p>
    </div>
  );
}
