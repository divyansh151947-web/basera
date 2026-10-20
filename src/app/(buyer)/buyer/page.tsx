import { getCurrentSession } from "@/lib/auth";
import { getPublicPropertyById, listPublicProperties, getRecommendedProperties } from "@/lib/data/properties";
import { getSavedProperties, getRecentlyViewedProperties, getVisitRequests, getComparisons, getBuyerPreferences } from "@/lib/data/buyer";
import { formatInr } from "@/lib/formatters";
import Link from "next/link";
import Image from "next/image";
import { MapPin, Building2, BedDouble, Heart, Scale, TrendingUp, CalendarClock, ArrowRight, Clock, ExternalLink } from "lucide-react";
import { BuyerDashboardStats } from "@/components/buyer/BuyerDashboardStats";
import { SavedPropertiesSection } from "@/components/buyer/SavedPropertiesSection";
import { RecentlyViewedSection } from "@/components/buyer/RecentlyViewedSection";
import { RecommendedPropertiesSection } from "@/components/buyer/RecommendedPropertiesSection";
import { UpcomingVisitsSection } from "@/components/buyer/UpcomingVisitsSection";
import { QuickActionsSection } from "@/components/buyer/QuickActionsSection";

export default async function BuyerDashboardPage() {
  const session = await getCurrentSession();
  if (!session?.user) return null;

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role;

  // Fetch buyer preferences for personalized recommendations
  const preferences = await getBuyerPreferences(userId);

  // Fetch saved properties for this buyer
  const savedPropertiesData = await getSavedProperties(userId);
  const savedProperties = savedPropertiesData.slice(0, 4).map(({ property, organization, savedAt }) => ({
    property,
    organization,
    savedAt,
  }));

  // Fetch recently viewed properties
  const recentlyViewedData = await getRecentlyViewedProperties(userId, 4);
  const recentProperties = recentlyViewedData.map(({ property, organization, viewedAt }) => ({
    property,
    organization,
    viewedAt,
  }));

  // Fetch upcoming visits
  const visitsData = await getVisitRequests(userId);
  const upcomingVisits = visitsData.slice(0, 4).map((visit) => ({
    ...visit,
    propertyId: visit.propertyId,
  }));

  // Fetch comparison count
  const comparisonsData = await getComparisons(userId);

  // Fetch recommended properties based on buyer preferences
  const recommendedData = await getRecommendedProperties(userId, preferences);
  const recommended = recommendedData.slice(0, 4).map(({ property, organization }) => ({
    property,
    organization,
  }));

  return (
    <div className="space-y-8">
      <div>
        <span className="eyebrow">Welcome back</span>
        <h1 className="mt-3 font-display text-3xl text-white">
          {session.user?.name?.split(" ")[0] ?? "Buyer"}, here&apos;s your property journey
        </h1>
      </div>

      <BuyerDashboardStats 
        userId={userId}
        savedCount={savedPropertiesData.length}
        comparisonCount={comparisonsData.length}
        visitCount={visitsData.length}
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6 min-w-0">
          <QuickActionsSection />
          
          <SavedPropertiesSection properties={savedProperties} userId={userId} />
          
          <UpcomingVisitsSection visits={upcomingVisits} />
        </div>

        <div className="space-y-6 min-w-0">
          <RecommendedPropertiesSection properties={recommended} />
          
          <RecentlyViewedSection properties={recentProperties} />
        </div>
      </div>
    </div>
  );
}