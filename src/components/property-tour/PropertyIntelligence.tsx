"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck2, ChevronRight, Home, MapPin, BedDouble, Bath, Car, Square, ArrowRight, LayoutDashboard } from "lucide-react";
import type { TourLocationId } from "./tour-types";
import { ROOM_INFO, NAV_ORDER } from "./tour-types";

interface PropertyIntelligenceProps {
  currentLocation: TourLocationId;
  onNavigate: (location: TourLocationId) => void;
  inTour: boolean;
}

type LucideIcon = React.ForwardRefExoticComponent<
  React.SVGProps<SVGSVGElement> & { size?: number }
>;

/**
 * Property Intelligence Panel
 * 
 * Replaces the former Voice AI command bar with a premium property
 * exploration and understanding interface. Connects to existing
 * camera navigation via onNavigate callback.
 * 
 * Data shown is illustrative marketing content for the showcase property
 * (Aurum Villa), not live listing data.
 */

// Static data - memoized at module level to avoid recreation on every render
const NAVIGABLE_ROOMS: TourLocationId[] = ["living", "kitchen", "bedroom", "bathroom", "balcony"];

const PROPERTY_DATA = {
  name: "Aurum Villa",
  type: "Premium Residence",
  location: "Gurugram, Sector 82",
  price: "₹1.35 Cr",
  bedrooms: 3,
  bathrooms: 3,
  parking: 2,
  area: "1,850 sq.ft.",
} as const;

const HIGHLIGHTS = [
  { icon: Home as LucideIcon, label: "Natural Light", desc: "East-facing living spaces with floor-to-ceiling glass" },
  { icon: MapPin as LucideIcon, label: "Premium Finishes", desc: "Teak, stone & glass palette throughout" },
  { icon: BedDouble as LucideIcon, label: "Open-Plan Living", desc: "Seamless flow between living, dining & kitchen" },
  { icon: Bath as LucideIcon, label: "Large Balcony", desc: "Glass railing with garden outlook" },
  { icon: Car as LucideIcon, label: "2 Car Parking", desc: "EV-ready with secure access" },
  { icon: Square as LucideIcon, label: "Private Pool", desc: "Landscaped deck with evening lighting" },
] as const;

const FLOOR_MAP = [
  { floor: "Ground Floor", rooms: ["Living Room", "Kitchen"] },
  { floor: "First Floor", rooms: ["Master Bedroom", "Bedroom", "Balcony"] },
  { floor: "Outdoor", rooms: ["Pool", "Garden", "Terrace", "Parking"] },
] as const;

// Pre-compute room ID lookup to avoid NAV_ORDER.find in render
const ROOM_ID_BY_LABEL: Record<string, TourLocationId | undefined> = {
  "Living Room": "living",
  "Kitchen": "kitchen",
  "Master Bedroom": "bedroom",
  "Bedroom": "bedroom",
  "Balcony": "balcony",
  "Pool": "pool",
  "Garden": "garden",
  "Terrace": "terrace",
  "Parking": "parking",
};

export function PropertyIntelligence({ currentLocation, onNavigate, inTour }: PropertyIntelligenceProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>("rooms");

  const isRoomActive = useMemo(() => (roomId: TourLocationId) => currentLocation === roomId, [currentLocation]);
  const isRoomNavigable = useMemo(() => (roomId: TourLocationId) => NAVIGABLE_ROOMS.includes(roomId), []);

  const handleRoomClick = useMemo(
    () => (roomId: TourLocationId) => {
      if (inTour && NAVIGABLE_ROOMS.includes(roomId)) {
        onNavigate(roomId);
      }
    },
    [inTour, onNavigate]
  );

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-auto">
      {/* Panel background with subtle animation */}
      <div className="absolute inset-y-0 inset-x-0 bg-gradient-to-t from-[#0a0e16] via-[#0a0e16]/95 to-transparent" />
      <div className="relative max-w-7xl mx-auto px-4 pb-6 pt-4">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 pb-4 border-b border-white/10">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#ffdf9e]">Property Intelligence</p>
            <h3 className="font-display text-2xl text-white mt-1">{PROPERTY_DATA.name}</h3>
            <p className="text-sm text-white/60 mt-0.5">{PROPERTY_DATA.type} · {PROPERTY_DATA.location}</p>
          </div>
          <div className="text-right">
            <p className="font-display text-2xl text-[#ffdf9e]">{PROPERTY_DATA.price}</p>
            <p className="text-[11px] text-white/50">{PROPERTY_DATA.area}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column - Property Overview */}
          <div className="lg:col-span-1 space-y-4">
            <SectionCard 
              title="Property Overview" 
              icon={Home as LucideIcon}
              expanded={expandedSection === "overview"}
              onToggle={() => toggleSection("overview")}
            >
              {/* 2-up grid: on very narrow screens (<360px) the value text
                  (e.g. "1,850 sq.ft.") overflows the card — stack to 1-up. */}
              <div className="grid max-[359px]:grid-cols-1 grid-cols-2 gap-3">
                <StatItem icon={BedDouble as LucideIcon} label="Bedrooms" value={PROPERTY_DATA.bedrooms} />
                <StatItem icon={Bath as LucideIcon} label="Bathrooms" value={PROPERTY_DATA.bathrooms} />
                <StatItem icon={Car as LucideIcon} label="Parking" value={PROPERTY_DATA.parking} />
                <StatItem icon={Square as LucideIcon} label="Area" value={PROPERTY_DATA.area} />
              </div>
            </SectionCard>

            {/* Why It Stands Out */}
            <SectionCard 
              title="Why It Stands Out" 
              icon={LayoutDashboard as LucideIcon}
              expanded={expandedSection === "highlights"}
              onToggle={() => toggleSection("highlights")}
            >
              <div className="space-y-3">
                {HIGHLIGHTS.map((highlight, i) => (
                  <div key={i} className="flex gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#d8a94e]/15 text-[#ffdf9e]">
                      <highlight.icon size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{highlight.label}</p>
                      <p className="text-xs text-white/60 mt-0.5 break-words">{highlight.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          {/* Center column - Explore Rooms */}
          <div className="lg:col-span-1 space-y-4">
            <SectionCard 
              title="Explore Rooms" 
              icon={LayoutDashboard as LucideIcon}
              expanded={expandedSection === "rooms"}
              onToggle={() => toggleSection("rooms")}
              defaultExpanded
            >
              <div className="space-y-2">
                {NAVIGABLE_ROOMS.map((roomId, i) => {
                  const roomInfo = ROOM_INFO[roomId as keyof typeof ROOM_INFO];
                  const isActive = isRoomActive(roomId);
                  const navItem = NAV_ORDER.find(n => n.id === roomId);
                  
                  return (
                    <button
                      key={roomId}
                      type="button"
                      onClick={() => handleRoomClick(roomId)}
                      disabled={!inTour || !isRoomNavigable(roomId)}
                      className={`w-full flex items-center gap-3 rounded-xl p-3 text-left transition-all duration-200 ${
                        isActive
                          ? "border-[#d8a94e]/50 bg-[#d8a94e]/10 text-[#ffdf9e]"
                          : "border-white/10 bg-white/[0.03] text-white/85 hover:border-[#d8a94e]/30 hover:bg-white/[0.05]"
                      } ${!inTour ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-medium bg-[#d8a94e]/15 text-[#ffdf9e]">
                        {navItem?.index ?? String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{roomInfo?.title ?? roomId}</p>
                        <p className="text-[11px] text-white/50 truncate">{roomInfo?.lines[0] ?? ""}</p>
                      </div>
                      <ArrowRight size={14} className="shrink-0 text-white/55" />
                    </button>
                  );
                })}
              </div>
              
              {/* Mini Floor Map */}
              <div className="mt-4 pt-4 border-t border-white/10">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50 mb-3">Floor Map</p>
                <div className="space-y-2">
                  {FLOOR_MAP.map((floor, fi) => (
                    <div key={floor.floor} className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60 mb-2">{floor.floor}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {floor.rooms.map((room, ri) => {
                          const roomId = ROOM_ID_BY_LABEL[room];
                          const isActive = roomId && isRoomActive(roomId);
                          
                          return (
                            <button
                              key={room}
                              type="button"
                              onClick={() => roomId && handleRoomClick(roomId)}
                              disabled={!inTour || !roomId || !isRoomNavigable(roomId)}
                              className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                                isActive
                                  ? "bg-[#d8a94e]/20 text-[#ffdf9e] border border-[#d8a94e]/30"
                                  : "bg-white/[0.03] text-white/70 border border-white/5 hover:bg-white/[0.05] hover:border-white/10"
                              } ${!inTour || !roomId || !isRoomNavigable(roomId) ? "opacity-40 cursor-not-allowed" : ""}`}
                            >
                              {room}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Right column - CTA */}
          <div className="lg:col-span-1">
            <div className="rounded-[1.6rem] border border-[#d8a94e]/30 bg-[#d8a94e]/10 p-6 h-full flex flex-col justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#ffdf9e] mb-2">Ready to Experience It?</p>
                <h4 className="font-display text-xl text-white mb-2">Schedule a Site Visit</h4>
                <p className="text-sm text-white/70 mb-6">
                  Walk through Aurum Villa with our sales team. Experience the spaces, 
                  ask questions, and see why buyers choose Basera-powered properties.
                </p>
              </div>
              
              <div className="space-y-3 pt-4 border-t border-[#d8a94e]/20">
                <Link
                  href="/signup"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#0a0e16] transition hover:bg-white/90"
                >
                  <CalendarCheck2 size={16} />
                  Schedule Site Visit
                </Link>
                <Link
                  href="/signup"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-transparent px-6 py-3 text-sm font-medium text-white/85 transition hover:border-white/50 hover:text-white"
                >
                  Explore Matching Properties
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Attribution */}
        <p className="mt-6 text-center text-[11px] text-white/55">
          Illustrative property data for showcase purposes. Actual listings available in Basera dashboard.
        </p>
      </div>
    </div>
  );
}

interface SectionCardProps {
  title: string;
  icon: LucideIcon;
  expanded: boolean;
  onToggle: () => void;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

function SectionCard({ title, icon: Icon, expanded, onToggle, defaultExpanded, children }: SectionCardProps) {
  const isOpen = expanded || defaultExpanded;
  
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] overflow-hidden transition-all duration-300">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 p-4"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#d8a94e]/15 text-[#ffdf9e]">
            <Icon size={20} />
          </div>
          <h4 className="text-lg font-semibold text-white">{title}</h4>
        </div>
        <ChevronRight 
          size={16} 
          className={`text-white/50 transition-transform duration-200 shrink-0 ${isOpen ? "rotate-90" : ""}`} 
        />
      </button>
      <div className={`${isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"} overflow-hidden transition-all duration-300 ease-in-out`}>
        <div className="px-4 pb-4">
          {children}
        </div>
      </div>
    </div>
  );
}

interface StatItemProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
}

function StatItem({ icon: Icon, label, value }: StatItemProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className="text-[#ffdf9e]" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">{label}</span>
      </div>
      <p className="font-display text-xl text-white">{value}</p>
    </div>
  );
}