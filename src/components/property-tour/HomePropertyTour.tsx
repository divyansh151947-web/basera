"use client";

import dynamic from "next/dynamic";
import { PropertyTourSkeleton } from "./PropertyTourSkeleton";

const PropertyTour = dynamic(() => import("./PropertyTour").then((mod) => mod.PropertyTour), {
  ssr: false,
  loading: () => <PropertyTourSkeleton />,
});

export function HomePropertyTour() {
  return <PropertyTour headingLevel="h2" />;
}