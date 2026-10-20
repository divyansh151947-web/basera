import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "@/lib/auth";
import { listPublicProperties, getPublicCities } from "@/lib/data/properties";
import { getSavedPropertyIds, getComparisonProperties } from "@/lib/data/buyer";
import { BuyerPropertyCard } from "@/components/buyer/BuyerPropertyCard";
import { Reveal } from "@/components/reveal";
import { PropertyFilters } from "@/app/(public)/explore/PropertyFilters";
import { Building2, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Explore Properties",
  description: "Browse verified properties from trusted developers. Filter by city, BHK, price, and property type.",
  alternates: { canonical: "/buyer/explore" },
  openGraph: {
    title: "Explore Properties | Basera",
    description: "Explore available properties with real prices and availability.",
    url: "/buyer/explore",
    siteName: "Basera",
    type: "website",
  },
};

function parseCoverImage(imagesJson: string | null | undefined): string | null {
  try {
    const list = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
  } catch {
    return null;
  }
}

export default async function BuyerExplorePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/buyer/login");
  if ((session.user as any).role !== "BUYER") redirect("/dashboard");

  const userId = (session.user as any).id as string;
  const params = await searchParams;
  
  const city = typeof params.city === "string" && params.city !== "All" ? params.city : undefined;
  const bhk = typeof params.bhk === "string" && params.bhk !== "All" ? Number(params.bhk.split(" ")[0]) : undefined;
  const propertyType = typeof params.propertyType === "string" && params.propertyType !== "All" ? params.propertyType : undefined;
  const search = typeof params.search === "string" && params.search !== "" ? params.search : undefined;
  const minPrice = typeof params.minPrice === "string" && params.minPrice !== "" ? Number(params.minPrice) : undefined;
  const maxPrice = typeof params.maxPrice === "string" && params.maxPrice !== "" ? Number(params.maxPrice) : undefined;
  const furnishing = typeof params.furnishing === "string" && params.furnishing !== "All" ? params.furnishing : undefined;
  const minArea = typeof params.minArea === "string" && params.minArea !== "" ? Number(params.minArea) : undefined;
  const maxArea = typeof params.maxArea === "string" && params.maxArea !== "" ? Number(params.maxArea) : undefined;
  const possessionTimeline = typeof params.possessionTimeline === "string" && params.possessionTimeline !== "All" ? params.possessionTimeline : undefined;
  const sortBy = typeof params.sortBy === "string" && params.sortBy !== "recommended" ? params.sortBy : undefined;

  const [properties, cities, savedPropertyIds, comparisonPropertyIds] = await Promise.all([
    listPublicProperties({ 
      city, 
      bhk, 
      propertyType, 
      search,
      minPrice,
      maxPrice,
      furnishing,
      minArea,
      maxArea,
      possessionTimeline,
      sortBy,
    }),
    getPublicCities(),
    getSavedPropertyIds(userId),
    getComparisonProperties(userId, "default").then(props => {
      const comparisonProps = props ?? [];
      const ids: string[] = [];
      for (const p of comparisonProps) {
        if (p != null && p.property != null) {
          ids.push(p.property.id);
        }
      }
      return ids;
    }).catch(() => []),
  ]);

  const savedSet = new Set(savedPropertyIds);
  const comparisonSet = new Set(comparisonPropertyIds);

  const propertiesWithCovers = properties.map(({ property, organization }) => ({
    property,
    organization,
    cover: parseCoverImage(property.imagesJson),
    isSaved: savedSet.has(property.id),
    isCompared: comparisonSet.has(property.id),
  }));

  return (
    <div className="space-y-8 theme-dark">
      <Reveal className="text-center">
        <span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Verified listings</span>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.02] text-white">Explore Properties</h1>
        <p className="mt-3 max-w-2xl mx-auto text-base leading-7 text-white/65">
          Browse available properties from our partner agencies. All listings are verified — real prices, real availability, no invented data.
        </p>
      </Reveal>

      <Reveal delayMs={80}>
        <PropertyFilters 
          cities={cities}
          initialCity={typeof params.city === "string" ? params.city : "All"}
          initialBhk={typeof params.bhk === "string" ? params.bhk : "All"}
          initialPropertyType={typeof params.propertyType === "string" ? params.propertyType : "All"}
          initialSearch={typeof params.search === "string" ? params.search : ""}
          initialMinPrice={typeof params.minPrice === "string" ? params.minPrice : ""}
          initialMaxPrice={typeof params.maxPrice === "string" ? params.maxPrice : ""}
          initialFurnishing={typeof params.furnishing === "string" ? params.furnishing : "All"}
          initialMinArea={typeof params.minArea === "string" ? params.minArea : ""}
          initialMaxArea={typeof params.maxArea === "string" ? params.maxArea : ""}
          initialPossessionTimeline={typeof params.possessionTimeline === "string" ? params.possessionTimeline : "All"}
          initialSortBy={typeof params.sortBy === "string" ? params.sortBy : "recommended"}
          resultCount={properties.length}
          isLoading={false}
        />
      </Reveal>

      <Reveal delayMs={120} className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {propertiesWithCovers.map(({ property, organization, cover, isSaved, isCompared }) => (
          <BuyerPropertyCard 
            key={property.id} 
            property={property} 
            organization={organization} 
            cover={cover}
            isSaved={isSaved}
            isCompared={isCompared}
            userId={userId}
          />
        ))}

        {properties.length === 0 && (
          <div className="col-span-full rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-12 text-center text-white/65">
            <Building2 size={48} className="mx-auto text-white/20" />
            <p className="mt-4 text-lg">No properties match your filters</p>
            <p className="mt-2 text-sm">Try adjusting your search or browse all listings.</p>
            <Link href="/buyer/explore" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#ffdf9e] hover:underline">
              Clear filters <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </Reveal>
    </div>
  );
}