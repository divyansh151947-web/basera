import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "@/lib/auth";
import { getSavedProperties } from "@/lib/data/buyer";
import { SavedPropertyCard } from "@/components/buyer/SavedPropertyCard";
import { Reveal } from "@/components/reveal";
import { Heart, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Saved Properties",
  description: "Your saved properties on Basera.",
  alternates: { canonical: "/buyer/saved" },
  robots: { index: false, follow: false },
};

function parseCoverImage(imagesJson: string | null | undefined): string | null {
  try {
    const list = JSON.parse(imagesJson ?? "[]");
    return Array.isArray(list) && typeof list[0] === "string" ? list[0] : null;
  } catch {
    return null;
  }
}

export default async function BuyerSavedPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/buyer/login");
  if ((session.user as any).role !== "BUYER") redirect("/dashboard");

  const userId = (session.user as any).id as string;
  const savedPropertiesData = await getSavedProperties(userId);

  return (
    <div className="space-y-8 theme-dark">
      <Reveal className="text-center">
        <span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Your Collection</span>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.02] text-white">Saved Properties</h1>
        <p className="mt-3 max-w-2xl mx-auto text-base leading-7 text-white/65">
          {savedPropertiesData.length} propert{savedPropertiesData.length !== 1 ? "ies" : "y"} saved. Click to view details or remove from your collection.
        </p>
      </Reveal>

      {savedPropertiesData.length === 0 ? (
        <Reveal delayMs={80}>
          <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-12 text-center text-white/65">
            <Heart size={48} className="mx-auto text-white/20" />
            <p className="mt-4 text-lg">No saved properties yet</p>
            <p className="mt-2 text-sm">Start exploring and save properties you like</p>
            <Link href="/buyer/explore" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#ffdf9e] hover:underline">
              Explore Properties <ArrowRight size={14} />
            </Link>
          </div>
        </Reveal>
      ) : (
        <Reveal delayMs={80} className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {savedPropertiesData.map(({ property, organization, savedAt }) => (
            <SavedPropertyCard 
              key={property.id} 
              property={property} 
              organization={organization} 
              savedAt={savedAt}
              userId={userId}
              cover={parseCoverImage(property.imagesJson)}
            />
          ))}
        </Reveal>
      )}
    </div>
  );
}