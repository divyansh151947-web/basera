"use client";

import { useEffect } from "react";
import { rememberLocationPreference } from "@/lib/location-preference";

// Records the city/locality of the property the visitor is currently viewing
// into first-party preference cookies, so the homepage video showcase can
// prioritise a walkthrough from that locality (then that city, then a
// deterministic fallback — see src/lib/featured-video.ts).
//
// This is derived purely from the listing the visitor chose to open — it is
// NOT geolocation: no coordinates are requested, read, or stored.
export function LocationPreferenceTracker({ city, locality }: { city: string; locality: string }) {
  useEffect(() => {
    rememberLocationPreference(city, locality);
  }, [city, locality]);
  return null;
}
