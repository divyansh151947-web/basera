import { getCurrentSession } from "@/lib/auth";
import { listProperties } from "@/lib/data/properties";
import { formatInr } from "@/lib/formatters";
import Link from "next/link";
import { redirect } from "next/navigation";
import NewPropertyButton from "./new-property-button";

export default async function PropertiesPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;
  const properties = await listProperties(organizationId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="eyebrow">Inventory</span>
          <h1 className="mt-3 font-display text-3xl text-ink">Properties</h1>
          <p className="mt-2 text-sm text-slate">{properties.length} active listing{properties.length !== 1 ? "s" : ""} in your inventory.</p>
        </div>
        <NewPropertyButton />
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {properties.map((p) => {
          const cover = (() => {
            try {
              const list = JSON.parse(p.imagesJson ?? "[]");
              return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
            } catch {
              return null;
            }
          })();
          return (
            <Link
              key={p.id}
              href={`/properties/${p.id}`}
              className="panel-surface card-hover group overflow-hidden"
            >
              <div className="relative h-48 overflow-hidden">
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 14px), linear-gradient(160deg, #16202f 0%, #101825 55%, #0f1f1a 100%)",
                  }}
                  aria-hidden
                />
                {cover && (
                  /* Plain img: property image URLs are user-supplied. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={cover}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                )}
                <div
                  className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/35"
                  aria-hidden
                />

                <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-2">
                  <span className="badge border-white/25 bg-black/35 text-white backdrop-blur-sm">
                    {p.propertyType ?? "Property"}
                  </span>
                  <span
                    className={`badge ${
                      p.availability === "AVAILABLE"
                        ? "border-success/30 bg-success-soft text-success"
                        : p.availability === "SOLD_OUT"
                          ? "border-danger/30 bg-danger-soft text-danger"
                          : "border-warning/30 bg-warning-soft text-warning"
                    }`}
                  >
                    {p.availability?.replace("_", " ") ?? "Available"}
                  </span>
                </div>

                <div className="absolute inset-x-4 bottom-4">
                  <p className="font-display text-xl leading-tight text-white">{p.projectName}</p>
                  <p className="mt-1 text-xs text-white/70">
                    {p.locality}, {p.city}
                  </p>
                </div>

                {p.videoUrl && (
                  <div className="absolute bottom-4 right-4 rounded-full bg-black/50 p-1.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-white/80">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                )}
              </div>

              <div className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">{p.bhk ? `${p.bhk} BHK` : "Home"}</span>
                  {p.furnishing && <span className="chip">{p.furnishing.replace("_", " ").toLowerCase()}</span>}
                  {p.areaSqft ? <span className="chip">{p.areaSqft.toLocaleString("en-IN")} sqft</span> : null}
                </div>

                <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-4">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate">Starting at</p>
                    <p className="mt-1 text-2xl font-semibold tracking-[-0.05em] text-brand">
                      {formatInr(p.priceMinInr)}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate transition-colors group-hover:text-brand">
                    View
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
                      <path d="M7 17 17 7" /><path d="M7 7h10v10" />
                    </svg>
                  </span>
                </div>

                {p.developer && <p className="mt-3 truncate text-sm text-slate">by {p.developer}</p>}
              </div>
            </Link>
          );
        })}

        {properties.length === 0 && (
          <div className="empty-state md:col-span-2 xl:col-span-3">
            No properties yet. Add your first listing to power AI matching.
          </div>
        )}
      </div>
    </div>
  );
}
