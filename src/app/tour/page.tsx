import type { Metadata } from "next";
import { TourPropertyTour } from "@/components/property-tour/TourPropertyTour";

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

export default function TourPage() {
  return <TourPropertyTour />;
}
