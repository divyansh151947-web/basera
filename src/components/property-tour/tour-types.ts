/**
 * Property tour data model (illustrative tour content, not listings).
 *
 * Every room spec below describes the ARCHITECTURE OF THE TOUR SCENE ITSELF
 * (what the camera visits), never a real listing, price, or availability
 * claim. The closing CTA routes to the real product (signup) for actual
 * property search. Nothing here may be presented as a live listing.
 */

export type TourLocationId =
  | "door"
  | "entrance"
  | "exterior"
  | "living"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "balcony"
  | "pool"
  | "garden"
  | "parking"
  | "terrace"
  | "rooftop"
  | "tower";

export interface TourVec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPreset {
  pos: TourVec3;
  look: TourVec3;
}

export interface RoomInfo {
  title: string;
  lines: string[];
}

export interface HotspotDef {
  id: string;
  label: string;
  /** Anchor in world space (scene module owns exact coordinates). */
  anchor: TourVec3;
  target: TourLocationId;
  /** Locations from which this hotspot is visible/clickable. */
  visibleFrom: TourLocationId[];
}

export const CAMERA_PRESETS: Record<TourLocationId, CameraPreset> = {
  // Cinematic hero 3/4 architectural angle: shows full villa + pool + landscape + city skyline
  // Slightly elevated, property centered, strong three-quarter view, breathing room for UI
  door: { pos: { x: 8.5, y: 4.2, z: 18.0 }, look: { x: 0.5, y: 2.5, z: -3.5 } },
  entrance: { pos: { x: 0, y: 1.7, z: 4.2 }, look: { x: 0, y: 1.6, z: -6 } },
  exterior: { pos: { x: 12.5, y: 4.0, z: 16.0 }, look: { x: -0.5, y: 2.5, z: -4 } },
  living: { pos: { x: -3.4, y: 1.8, z: -1.5 }, look: { x: -5.5, y: 1.2, z: -7 } },
  kitchen: { pos: { x: 3.2, y: 1.9, z: -2.5 }, look: { x: 5.6, y: 1.2, z: -7 } },
  bedroom: { pos: { x: -3.0, y: 1.8, z: -11.5 }, look: { x: -5.2, y: 1.1, z: -16 } },
  bathroom: { pos: { x: -4.4, y: 1.7, z: -16.2 }, look: { x: -6.6, y: 1.1, z: -18.4 } },
  balcony: { pos: { x: 2.8, y: 4.6, z: -1.2 }, look: { x: 10, y: 2.2, z: -4 } },
  pool: { pos: { x: 9.5, y: 2.2, z: 3.5 }, look: { x: 16, y: 0.6, z: -2 } },
  garden: { pos: { x: -6.5, y: 2.4, z: 7.5 }, look: { x: 2, y: 1.4, z: -2 } },
  parking: { pos: { x: -9.5, y: 2.0, z: 4.5 }, look: { x: -16, y: 0.8, z: 0 } },
  terrace: { pos: { x: 0, y: 7.6, z: -9.0 }, look: { x: 0, y: 6.4, z: -18 } },
  rooftop: { pos: { x: 6.5, y: 8.2, z: -8.5 }, look: { x: -4, y: 5.5, z: -22 } },
  tower: { pos: { x: 26, y: 18, z: 30 }, look: { x: 0, y: 6, z: 0 } },
};

/** Cinematic opening dolly (same world, same assets — the "video" is the scene itself). */
export const CINE_INTRO_FROM: CameraPreset = {
  pos: { x: 20, y: 6.5, z: 26 },
  look: { x: 0.5, y: 2.5, z: -3.5 },
};

export const ROOM_INFO: Record<Exclude<TourLocationId, "door" | "entrance" | "tower">, RoomInfo> = {
  exterior: { title: "Exterior", lines: ["Golden-hour facade", "Teak + stone + glass", "Landscaped court", "Driveway + pool deck"] },
  living: { title: "Living Room", lines: ["3 BHK layout", "1,850 sq.ft. tour plan", "Premium finishes", "East facing"] },
  kitchen: { title: "Kitchen", lines: ["Modular fittings", "Island counter", "Morning light", "Utility deck"] },
  bedroom: { title: "Bedroom", lines: ["Natural lighting", "Built-in storage", "Premium flooring", "Garden view"] },
  bathroom: { title: "Bathroom", lines: ["Stone tile", "Soaking tub", "Vanity + mirror", "Warm lighting"] },
  balcony: { title: "Balcony", lines: ["Glass railing", "Garden outlook", "Evening deck", "First floor"] },
  pool: { title: "Swimming Pool", lines: ["Outdoor leisure area", "Private pool", "Landscape garden", "Evening lighting"] },
  garden: { title: "Garden", lines: ["Landscaped lawn", "Native planting", "Path lighting", "Family space"] },
  parking: { title: "Parking", lines: ["2 car parking", "EV-ready", "Secure access"] },
  terrace: { title: "Terrace", lines: ["Sky deck", "Pergola lounge", "City skyline", "Sunset view"] },
  rooftop: { title: "Rooftop", lines: ["Open sky lounge", "Dining deck", "Sunset panorama", "City lights"] },
};

export const HOTSPOTS: HotspotDef[] = [
  { id: "hs-exterior", label: "Exterior", anchor: { x: 0, y: 3.0, z: 2 }, target: "exterior", visibleFrom: ["tower", "garden", "parking", "pool", "balcony", "terrace"] },
  { id: "hs-living", label: "Living Room", anchor: { x: -4.5, y: 1.8, z: -5 }, target: "living", visibleFrom: ["entrance", "kitchen", "bedroom", "bathroom"] },
  { id: "hs-kitchen", label: "Kitchen", anchor: { x: 4.5, y: 1.8, z: -5 }, target: "kitchen", visibleFrom: ["entrance", "living", "bedroom", "bathroom"] },
  { id: "hs-bedroom", label: "Bedroom", anchor: { x: -4.2, y: 1.8, z: -13 }, target: "bedroom", visibleFrom: ["entrance", "living", "kitchen", "bathroom", "balcony"] },
  { id: "hs-bathroom", label: "Bathroom", anchor: { x: -6.2, y: 1.6, z: -18 }, target: "bathroom", visibleFrom: ["bedroom", "entrance"] },
  { id: "hs-balcony", label: "Balcony", anchor: { x: 1.5, y: 4.4, z: -0.5 }, target: "balcony", visibleFrom: ["entrance", "garden", "pool", "terrace"] },
  { id: "hs-pool", label: "Swimming Pool", anchor: { x: 14, y: 1.6, z: 0 }, target: "pool", visibleFrom: ["entrance", "terrace", "tower", "garden", "balcony", "exterior"] },
  { id: "hs-garden", label: "Garden", anchor: { x: -4, y: 1.4, z: 6 }, target: "garden", visibleFrom: ["entrance", "pool", "parking", "balcony", "exterior"] },
  { id: "hs-parking", label: "Parking", anchor: { x: -14, y: 1.6, z: 1.5 }, target: "parking", visibleFrom: ["entrance", "tower", "garden", "exterior"] },
  { id: "hs-terrace", label: "Terrace", anchor: { x: 0, y: 7.4, z: -14 }, target: "terrace", visibleFrom: ["entrance", "pool", "tower", "balcony", "rooftop"] },
  { id: "hs-rooftop", label: "Rooftop", anchor: { x: 4, y: 8.0, z: -15 }, target: "rooftop", visibleFrom: ["terrace", "tower", "balcony"] },
  { id: "hs-tower", label: "3D Tour · Building", anchor: { x: 0, y: 4.5, z: -6 }, target: "tower", visibleFrom: ["entrance", "pool", "parking", "terrace", "garden", "rooftop", "exterior"] },
];

export const NAV_ORDER: { id: TourLocationId; index: string; label: string }[] = [
  { id: "exterior", index: "01", label: "Exterior" },
  { id: "living", index: "02", label: "Living Room" },
  { id: "kitchen", index: "03", label: "Kitchen" },
  { id: "bedroom", index: "04", label: "Bedroom" },
  { id: "bathroom", index: "05", label: "Bathroom" },
  { id: "balcony", index: "06", label: "Balcony" },
  { id: "pool", index: "07", label: "Pool" },
  { id: "garden", index: "08", label: "Garden" },
  { id: "parking", index: "09", label: "Parking" },
  { id: "terrace", index: "10", label: "Terrace" },
  { id: "rooftop", index: "11", label: "Rooftop" },
];

export const FLOORS = ["Ground Floor", "First Floor", "Second Floor", "Penthouse"] as const;
