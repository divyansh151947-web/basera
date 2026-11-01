"use client";

import dynamic from "next/dynamic";

const PropertyTour = dynamic(() => import("./PropertyTour").then((mod) => mod.PropertyTour), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[70vh] items-center justify-center" aria-busy="true">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#d8a94e] border-t-transparent" />
    </div>
  ),
});

export function TourPropertyTour() {
  return <PropertyTour />;
}