import type { Metadata } from "next";
import { PropertyVideo } from "@/app/(public)/explore/[id]/PropertyVideo";
import { notFound } from "next/navigation";
import { getPublicPropertyById, listPublicProperties } from "@/lib/data/properties";
import { formatInr } from "@/lib/formatters";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Building2, BedDouble, Square, ArrowRight, ArrowLeft, Maximize, Minimize, ChevronLeft, ChevronRight, X, TrendingUp, TrendingDown, HelpCircle, Loader2 } from "lucide-react";
import { PropertyGallery } from "./PropertyGallery";
import { ConstructionProgress } from "./ConstructionProgress";
import { SimilarProperties } from "./SimilarProperties";
import { RecentlyViewed } from "./RecentlyViewed";
import { LocationPreferenceTracker } from "./LocationPreferenceTracker";
import { PropertyActions } from "./PropertyActions";
import { PublicChatWidget } from "@/components/public-chat-widget";
import LazyPriceHistoryChart from "./LazyPriceHistoryChart";

// Below-fold price chart carries the recharts dependency (~108 KB). It used to
// be declared with next/dynamic directly in this Server Component, which put the
// recharts chunk into the page's startup chunk list (eagerly downloaded at
// ~216ms on every detail view). LazyPriceHistoryChart is a Client Component that
// defers both the download and hydration until the section nears the viewport.
// Same props, same visuals.
const PriceHistoryChart = LazyPriceHistoryChart;

interface PropertyWithOrg {
  property: {
    id: string;
    projectName: string;
    developer: string | null;
    propertyType: string;
    bhk: number | null;
    city: string;
    locality: string;
    address: string | null;
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
    parking: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await getPublicPropertyById(id);
  if (!data) return { title: "Property Not Found" };

  const { property, organization } = data;
  return {
    title: `${property.projectName} — ${property.locality}, ${property.city} | Basera`,
    description: `${property.bhk ? `${property.bhk} BHK ` : ""}${property.propertyType} in ${property.locality}, ${property.city} starting at ${formatInr(property.priceMinInr)}. Listed by ${organization.name}.`,
    alternates: { canonical: `/explore/${id}` },
    openGraph: {
      title: `${property.projectName} — ${property.locality}, ${property.city}`,
      description: `${property.bhk ? `${property.bhk} BHK ` : ""}${property.propertyType} starting at ${formatInr(property.priceMinInr)}. ${property.description?.slice(0, 160) ?? ""}`,
      url: `/explore/${id}`,
      siteName: "Basera",
      type: "website",
      images: property.imagesJson ? JSON.parse(property.imagesJson).slice(0, 1) : [],
    },
  };
}

function parseImages(imagesJson: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string") : [];
  } catch {
    return [];
  }
}

function parseAmenities(amenitiesJson: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(amenitiesJson ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function PropertySkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12 animate-pulse">
      <div className="h-8 w-48 rounded bg-white/5" />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-[1.6rem] overflow-hidden border border-white/10 bg-white/[0.04]">
            {/* aspect + min-h demands a 711px intrinsic slot — keep the
                skeleton matching the real gallery below lg. */}
            <div className="relative max-lg:aspect-auto min-h-[400px] bg-white/5" />
          </div>
          <div className="h-12 w-3/4 rounded bg-white/5" />
          <p className="h-4 w-1/2 rounded bg-white/5" />
          <div className="grid gap-4 md:grid-cols-2 border-y border-white/10 py-6">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="space-y-3">
                <p className="h-3 w-24 rounded bg-white/5" />
                <p className="h-6 w-32 rounded bg-white/5" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="panel-surface p-5 sticky top-24">
            <p className="h-4 w-40 rounded bg-white/5" />
            <p className="h-4 w-60 rounded bg-white/5" />
            <div className="mt-4 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 w-full rounded bg-white/5" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function PublicPropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getPublicPropertyById(id);
  if (!data) notFound();

  const { property, organization } = data;

  const images = parseImages(property.imagesJson);
  const amenities = parseAmenities(property.amenitiesJson);
  const hasVideo = Boolean(property.videoUrl);
  const videoUrl = property.videoUrl ?? null;
  const videoPosterUrl = property.videoPosterUrl ?? null;

  // Fetch similar properties (same city, similar price range, same BHK or type).
  // We only ever render 4 cards (and drop the current property), so cap the SQL
  // at 6 rows instead of materialising every match in the demo-org set.
  const similarProperties = await listPublicProperties(
    {
      city: property.city,
      propertyType: property.propertyType,
      bhk: property.bhk ?? undefined,
      minPrice: Math.max(0, property.priceMinInr - 2000000),
      maxPrice: property.priceMaxInr + 2000000,
    },
    { limit: 6 }
  );

  // Filter out current property and limit to 4
  const filteredSimilar = similarProperties
    .filter(({ property: p }) => p.id !== property.id)
    .slice(0, 4);

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <LocationPreferenceTracker city={property.city} locality={property.locality} />
      <Link href="/explore" className="inline-flex items-center gap-1.5 text-sm font-medium text-white/65 hover:text-white transition">
        <ArrowLeft size={14} /> Back to listings
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <PropertyGallery images={images} propertyName={property.projectName} locality={property.locality} city={property.city} />
          {hasVideo && videoUrl && (
            <PropertyVideo
              url={videoUrl}
              posterUrl={videoPosterUrl}
              title={property.projectName}
            />
          )}

          <div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70">{property.propertyType.replace("_", " ")}</span>
              {property.bhk && <span className="rounded-full border border-success/30 bg-success-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-success">{property.bhk} BHK</span>}
              <span className="rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#ffdf9e]">{property.availability?.replace("_", " ")}</span>
            </div>

            <h1 className="font-display text-3xl md:text-4xl leading-tight text-white">{property.projectName}</h1>
            <p className="mt-2 flex items-center gap-1.5 text-base text-white/70">
              <MapPin size={18} className="text-[#ffdf9e]" />
              <span>{property.locality}, {property.city}</span>
              {property.address && <span className="mx-2 text-white/30">·</span>}
              {property.address && <span>{property.address}</span>}
            </p>
            {property.developer && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/50">
                <Building2 size={14} /> by {property.developer}
              </p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 border-y border-white/10 py-6">
            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Price range</p>
              <p className="text-2xl font-semibold text-[#ffdf9e]">{formatInr(property.priceMinInr)} – {formatInr(property.priceMaxInr)}</p>
            </div>
            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Property type</p>
              <p className="font-medium text-white capitalize">{property.propertyType.toLowerCase().replace("_", " ")}{property.bhk ? ` · ${property.bhk} BHK` : ""}</p>
            </div>
            {property.areaSqft && (
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Area</p>
                <p className="font-medium text-white">{property.areaSqft.toLocaleString("en-IN")} sqft</p>
                <p className="text-sm text-white/50">≈ {formatInr(Math.round(property.priceMinInr / (property.areaSqft || 1)))} / sqft</p>
              </div>
            )}
            {property.furnishing && (
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Furnishing</p>
                <p className="font-medium text-white capitalize">{property.furnishing.replace("_", " ").toLowerCase()}</p>
              </div>
            )}
            {property.possessionDate && (
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Possession</p>
                <p className="font-medium text-white">{property.possessionDate}</p>
              </div>
            )}
            {property.floor && (
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Floor</p>
                <p className="font-medium text-white">{property.floor}</p>
              </div>
            )}
            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Parking</p>
              <p className="font-medium text-white">{property.parking ? "Available" : "Not available"}</p>
            </div>
            <div className="space-y-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/60">Listed by</p>
              <p className="font-medium text-white">{organization.name}</p>
            </div>
          </div>

          {property.description && (
            <div className="panel-surface p-5">
              <h2 className="text-sm font-semibold text-white">About this property</h2>
              <p className="mt-3 leading-7 text-white/80">{property.description}</p>
            </div>
          )}

          {amenities.length > 0 && (
            <div className="panel-surface p-5">
              <h2 className="text-sm font-semibold text-white">Amenities</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {amenities.map((a) => (
                  <span key={a} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm text-white/80">{a}</span>
                ))}
              </div>
            </div>
          )}

          <ConstructionProgress property={property} />

          <PriceHistoryChart property={property} />

          <SimilarProperties properties={filteredSimilar} currentPropertyId={property.id} />

          <RecentlyViewed currentPropertyId={property.id} />
        </div>

        <div className="space-y-4">
          <PropertyActions 
            propertyId={property.id}
            projectName={property.projectName}
            locality={property.locality}
            city={property.city}
            organizationName={organization.name}
          />

          <div className="panel-surface p-5">
            <h2 className="text-sm font-semibold text-white">Explore more</h2>
            <div className="mt-3 space-y-2">
              <Link href="/explore" className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-white/70 hover:bg-white/5 transition">Find more properties</Link>
              <Link href="/tour" className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-white/70 hover:bg-white/5 transition">Experience 3D Tour</Link>
              <Link href="/signup" className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-white/70 hover:bg-white/5 transition">List your properties (for agents)</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Property-scoped AI assistant: opened by the "Chat with AI Assistant"
          CTA and grounded on this property's verified data server-side. */}
      <PublicChatWidget propertyId={property.id} contextLabel={`${property.projectName} · Basera AI`} />
    </div>
  );
}