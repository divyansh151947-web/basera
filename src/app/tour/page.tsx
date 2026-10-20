import type { Metadata } from "next";
import dynamic from "next/dynamic";

export const metadata: Metadata = {
  title: "Interactive 3D Property Tour",
  description:
    "Enter a cinematic interactive property: open the door, explore rooms, and ask Basera AI — then discover the revenue operating system.",
  alternates: { canonical: "/tour" },
  openGraph: {
    title: "Interactive 3D Property Tour | Basera",
    description:
      "Explore a property in live 3D — rooms, floors, and voice-guided navigation powered by Basera AI.",
    url: "/tour",
    siteName: "Basera",
    type: "website",
  },
};

/**
 * Additive cinematic tour route. The existing homepage, dashboard, and all
 * product behavior are untouched; this page stands alone.
 * The 3D world (three.js) loads client-side on demand — same tour, same
 * interactions, just out of the initial SSR bundle.
 */
const PropertyTour = dynamic(() => import("@/components/property-tour/PropertyTour").then((m) => m.PropertyTour), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[70vh] items-center justify-center" aria-busy="true">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#d8a94e] border-t-transparent" />
    </div>
  ),
});

export default function TourPage() {
  return <PropertyTour />;
}
