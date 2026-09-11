import { getCurrentSession } from "@/lib/auth";
import { listProperties } from "@/lib/data/properties";
import { formatInr } from "@/components/ui";
import Link from "next/link";
import NewPropertyButton from "./new-property-button";

export default async function PropertiesPage() {
  const session = await getCurrentSession();
  const organizationId = (session!.user as any).organizationId as string;
  const properties = await listProperties(organizationId);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink">Properties</h1>
          <p className="text-sm text-slate2 mt-1">{properties.length} active listing{properties.length !== 1 ? "s" : ""} in your inventory.</p>
        </div>
        <NewPropertyButton />
      </div>

      <div className="grid md:grid-cols-3 gap-4 mt-6">
        {properties.map((p) => (
          <Link key={p.id} href={`/properties/${p.id}`} className="rounded-lg border border-line bg-panel p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-center justify-between">
              <p className="font-medium text-ink">{p.projectName}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full ${p.availability === "AVAILABLE" ? "bg-brand-light text-brand" : p.availability === "SOLD_OUT" ? "bg-hot/10 text-hot" : "bg-gold-light text-gold"}`}>
                {p.availability.replace("_", " ")}
              </span>
            </div>
            <p className="text-sm text-slate2 mt-1">{p.locality}, {p.city}</p>
            <p className="text-sm text-ink mt-2">{p.bhk ? `${p.bhk} BHK` : p.propertyType} · {formatInr(p.priceMinInr)}–{formatInr(p.priceMaxInr)}</p>
            {p.developer && <p className="text-xs text-slate2 mt-1">by {p.developer}</p>}
          </Link>
        ))}
        {properties.length === 0 && <p className="text-sm text-slate2 col-span-3 text-center py-10">No properties yet. Add your first listing.</p>}
      </div>
    </div>
  );
}
