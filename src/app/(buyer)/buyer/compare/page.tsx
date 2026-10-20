import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "@/lib/auth";
import { getComparisons, getComparisonProperties } from "@/lib/data/buyer";
import { ComparisonTable } from "@/components/buyer/ComparisonTable";
import { Reveal } from "@/components/reveal";
import { Scale, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Compare Properties",
  description: "Compare properties side by side on Basera.",
  alternates: { canonical: "/buyer/compare" },
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

export default async function BuyerComparePage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/buyer/login");
  if ((session.user as any).role !== "BUYER") redirect("/dashboard");

  const userId = (session.user as any).id as string;
  const comparisons = await getComparisons(userId);

  // Get the first comparison (or default)
  const comparison = comparisons[0];
  let propertiesData: Array<{ property: any; organization: { id: string; name: string; slug: string } } | undefined> = [];
  
  if (comparison) {
    propertiesData = await getComparisonProperties(userId, comparison.id) as Array<{ property: any; organization: { id: string; name: string; slug: string } } | undefined>;
  }

  // Filter out any undefined values
  const filteredPropertiesData = propertiesData.filter((p): p is { property: any; organization: { id: string; name: string; slug: string } } => p != null);

  return (
    <div className="space-y-8 theme-dark">
      <Reveal className="text-center">
        <span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Comparison Tool</span>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.02] text-white">Compare Properties</h1>
        <p className="mt-3 max-w-2xl mx-auto text-base leading-7 text-white/65">
          {comparison ? `Comparing ${filteredPropertiesData.length} properties` : "No active comparison. Add properties from explore or property details."}
        </p>
      </Reveal>

      {filteredPropertiesData.length === 0 ? (
        <Reveal delayMs={80}>
          <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-12 text-center text-white/65">
            <Scale size={48} className="mx-auto text-white/20" />
            <p className="mt-4 text-lg">No properties to compare</p>
            <p className="mt-2 text-sm">Add at least 2 properties to start comparing</p>
            <Link href="/buyer/explore" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#ffdf9e] hover:underline">
              Explore Properties <ArrowRight size={14} />
            </Link>
          </div>
        </Reveal>
      ) : (
        <>
          <Reveal delayMs={80}>
            <ComparisonTable properties={filteredPropertiesData} comparisonId={comparison?.id} userId={userId} />
          </Reveal>

          {comparisons.length > 1 && (
            <Reveal delayMs={160}>
              <div className="panel-surface p-5">
                <h2 className="text-lg font-semibold text-white mb-4">Other Comparisons</h2>
                <div className="space-y-2">
                  {comparisons.slice(1).map((comp) => (
                    <Link
                      key={comp.id}
                      href={`/buyer/compare?id=${comp.id}`}
                      className="flex items-center justify-between p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
                    >
                      <div className="flex items-center gap-3">
                        <Scale size={18} className="text-[#3b82f6]" />
                        <div>
                          <p className="font-medium text-white">{comp.name || "Unnamed Comparison"}</p>
                          <p className="text-sm text-white/50">
                            {JSON.parse(comp.propertyIds).length} properties · Updated {new Date(comp.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <ArrowRight size={18} className="text-white/50" />
                    </Link>
                  ))}
                </div>
              </div>
            </Reveal>
          )}

          <Reveal delayMs={200}>
            <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6 text-center shadow-[0_18px_42px_rgba(0,0,0,0.35)] backdrop-blur-sm md:p-8">
              <span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Want deeper insights?</span>
              <h2 className="mt-4 font-display text-2xl text-white">Investment Insights</h2>
              <p className="mt-3 max-w-2xl mx-auto text-sm leading-7 text-white/65">
                Analyze price trends, calculate returns, and make informed investment decisions.
              </p>
              <Link href="/buyer/insights" className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#0a0e16] transition hover:bg-white/90">
                <ArrowRight size={14} /> Open Investment Insights
              </Link>
            </div>
          </Reveal>
        </>
      )}
    </div>
  );
}