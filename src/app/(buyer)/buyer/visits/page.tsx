import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "@/lib/auth";
import { getVisitRequests } from "@/lib/data/buyer";
import { getPublicPropertyById } from "@/lib/data/properties";
import { ScheduleVisitForm } from "@/components/buyer/ScheduleVisitForm";
import { VisitList } from "@/components/buyer/VisitList";
import { Reveal } from "@/components/reveal";
import { CalendarClock, ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Visit Requests",
  description: "Manage your property site visit requests.",
  alternates: { canonical: "/buyer/visits" },
  robots: { index: false, follow: false },
};

export default async function BuyerVisitsPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/buyer/login");
  if ((session.user as any).role !== "BUYER") redirect("/dashboard");

  const userId = (session.user as any).id as string;
  const visits = await getVisitRequests(userId);

  // Enrich visits with property data
  const enrichedVisits = await Promise.all(
    visits.map(async (visit) => {
      const property = await getPublicPropertyById(visit.propertyId);
      return {
        ...visit,
        property: property?.property ?? null,
      };
    })
  );

  const upcomingVisits = enrichedVisits.filter(v => 
    ["REQUESTED", "SCHEDULED", "CONFIRMED"].includes(v.status)
  );
  const pastVisits = enrichedVisits.filter(v => 
    ["COMPLETED", "CANCELED", "NO_SHOW"].includes(v.status)
  );

  return (
    <div className="space-y-8 theme-dark">
      <Reveal className="text-center">
        <span className="inline-flex items-center rounded-full border border-[#d8a94e]/30 bg-[#d8a94e]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#ffdf9e]">Site Visits</span>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,4vw,3.3rem)] leading-[1.02] text-white">Visit Requests</h1>
        <p className="mt-3 max-w-2xl mx-auto text-base leading-7 text-white/65">
          Manage your site visit requests. Schedule new visits and track upcoming appointments.
        </p>
      </Reveal>

      <Reveal delayMs={80}>
        <div className="panel-surface p-5">
          <h2 className="text-lg font-semibold text-white mb-4">Schedule a New Visit</h2>
          <p className="text-sm text-white/50 mb-4">Select a property and preferred date/time for your site visit.</p>
          <ScheduleVisitForm userId={userId} />
        </div>
      </Reveal>

      {upcomingVisits.length > 0 && (
        <Reveal delayMs={160}>
          <VisitList title="Upcoming Visits" visits={upcomingVisits} showActions />
        </Reveal>
      )}

      {pastVisits.length > 0 && (
        <Reveal delayMs={240}>
          <VisitList title="Visit History" visits={pastVisits} showActions={false} />
        </Reveal>
      )}

      {enrichedVisits.length === 0 && (
        <Reveal delayMs={160}>
          <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-12 text-center text-white/65">
            <CalendarClock size={48} className="mx-auto text-white/20" />
            <p className="mt-4 text-lg">No visit requests yet</p>
            <p className="mt-2 text-sm">Schedule a site visit for a property you like</p>
            <Link href="/buyer/explore" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#ffdf9e] hover:underline">
              Explore Properties <ArrowRight size={14} />
            </Link>
          </div>
        </Reveal>
      )}
    </div>
  );
}