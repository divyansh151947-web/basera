import type { Metadata } from "next";
import { listPublicProperties, getPublicCities } from "@/lib/data/properties";
import Link from "next/link";
import { MapPin, Building2, BedDouble, Square, ArrowRight, Filter, ChevronDown } from "lucide-react";
import { Reveal } from "@/components/reveal";
import { PropertyFilters } from "./PropertyFilters";
import { PropertyCard } from "./PropertyCard";

export const metadata: Metadata = {
  title: "Find a Property",
  description: "Browse verified properties from trusted developers. Filter by city, BHK, price, and property type.",
  alternates: { canonical: "/explore" },
  openGraph: {
    title: "Find a Property | Basera",
    description: "Explore available properties with real prices and availability.",
    url: "/explore",
    siteName: "Basera",
    type: "website",
  },
};

interface PropertyWithOrg {
  property: {
    id: string;
    projectName: string;
    developer: string | null;
    propertyType: string;
    bhk: number | null;
    city: string;
    locality: string;
    priceMinInr: number;
    priceMaxInr: number;
    areaSqft: number | null;
    floor: string | null;
    furnishing: string | null;
    possessionDate: string | null;
    availability: string;
    description: string | null;
    imagesJson: string;
    amenitiesJson: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
}

// Parse cover image once at module level
function parseCoverImage(imagesJson: string | null | undefined): string | null {
  try {
    const list = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
  } catch {
    return null;
  }
}

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
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

  const [properties, cities] = await Promise.all([
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
  ]);

  // Pre-parse cover images
  const propertiesWithCovers = properties.map(({ property, organization }) => ({
    property,
    organization,
    cover: parseCoverImage(property.imagesJson),
  }));

  return (
    <div className="space-y-8 theme-dark">
      <Reveal className="text-center">
        <span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Verified listings</span>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.02] text-white">Find your next property</h1>
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
{propertiesWithCovers.map(({ property, organization, cover }) => (
          <PropertyCard 
            key={property.id} 
            property={property} 
            organization={organization} 
            cover={cover}
          />
        ))}

        {properties.length === 0 && (
          <div className="col-span-full rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-12 text-center text-white/65">
            <Building2 size={48} className="mx-auto text-white/20" />
            <p className="mt-4 text-lg">No properties match your filters</p>
            <p className="mt-2 text-sm">Try adjusting your search or browse all listings.</p>
            <Link href="/explore" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#ffdf9e] hover:underline">
              Clear filters <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </Reveal>

      <Reveal delayMs={200} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 text-center shadow-[0_18px_42px_rgba(0,0,0,0.35)] backdrop-blur-sm md:p-8">
        <span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">For real-estate professionals</span>
        <h2 className="mt-4 font-display text-2xl text-white">Basera team dashboard</h2>
        <p className="mt-3 max-w-2xl mx-auto text-sm leading-7 text-white/65">
          Staff members can sign in to manage properties, leads, and appointments.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/login" className="inline-flex items-center justify-center rounded-xl border border-white/20 px-5 py-3 text-sm font-medium text-white/85 transition hover:border-white/50 hover:text-white">Staff Login</Link>
        </div>
      </Reveal>
    </div>
  );
}