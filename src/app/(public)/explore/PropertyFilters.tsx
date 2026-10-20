"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Filter, BedDouble, Building2, X, ChevronDown, ChevronUp, Search, SlidersHorizontal, Loader2 } from "lucide-react";
import { Select } from "@/components/Select";
import { rememberCityPreference } from "@/lib/location-preference";

interface PropertyFiltersProps {
  cities: string[];
  initialCity: string;
  initialBhk: string;
  initialPropertyType: string;
  initialSearch: string;
  initialMinPrice: string;
  initialMaxPrice: string;
  initialFurnishing: string;
  initialMinArea: string;
  initialMaxArea: string;
  initialPossessionTimeline: string;
  initialSortBy: string;
  resultCount: number;
  isLoading: boolean;
}

const BHK_OPTIONS = [
  { value: "All", label: "Any BHK" },
  { value: "1 BHK", label: "1 BHK" },
  { value: "2 BHK", label: "2 BHK" },
  { value: "3 BHK", label: "3 BHK" },
  { value: "4 BHK", label: "4 BHK" },
  { value: "5+ BHK", label: "5+ BHK" },
] as const;

const PROPERTY_TYPES = [
  { value: "All", label: "All Types" },
  { value: "APARTMENT", label: "Apartment / Flat" },
  { value: "INDEPENDENT_HOUSE", label: "Independent House" },
  { value: "VILLA", label: "Villa" },
  { value: "PLOT", label: "Plot / Land" },
  { value: "COMMERCIAL", label: "Commercial" },
] as const;

const FURNISHING_OPTIONS = [
  { value: "All", label: "Any Furnishing" },
  { value: "UNFURNISHED", label: "Unfurnished" },
  { value: "SEMI_FURNISHED", label: "Semi Furnished" },
  { value: "FULLY_FURNISHED", label: "Fully Furnished" },
] as const;

const POSSESSION_OPTIONS = [
  { value: "All", label: "Any Possession" },
  { value: "Ready to Move", label: "Ready to Move" },
  { value: "Under Construction", label: "Under Construction" },
  { value: "Upcoming", label: "Upcoming" },
] as const;

const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "area_desc", label: "Largest Area" },
  { value: "newest", label: "Newest Listings" },
] as const;

const BUDGET_PRESETS = [
  { label: "Under ₹50L", min: 0, max: 5000000 },
  { label: "₹50L - ₹1Cr", min: 5000000, max: 10000000 },
  { label: "₹1Cr - ₹2Cr", min: 10000000, max: 20000000 },
  { label: "₹2Cr - ₹5Cr", min: 20000000, max: 50000000 },
  { label: "₹5Cr+", min: 50000000, max: 0 },
] as const;

function formatInrCompact(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(amount % 10000000 === 0 ? 0 : 1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(amount % 100000 === 0 ? 0 : 1)}L`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function PropertyFilters({
  cities,
  initialCity,
  initialBhk,
  initialPropertyType,
  initialSearch,
  initialMinPrice,
  initialMaxPrice,
  initialFurnishing,
  initialMinArea,
  initialMaxArea,
  initialPossessionTimeline,
  initialSortBy,
  resultCount,
  isLoading,
}: PropertyFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(initialSearch);
  const [city, setCity] = useState(initialCity);
  const [bhk, setBhk] = useState(initialBhk);
  const [propertyType, setPropertyType] = useState(initialPropertyType);
  const [minPrice, setMinPrice] = useState(initialMinPrice);
  const [maxPrice, setMaxPrice] = useState(initialMaxPrice);
  const [furnishing, setFurnishing] = useState(initialFurnishing);
  const [minArea, setMinArea] = useState(initialMinArea);
  const [maxArea, setMaxArea] = useState(initialMaxArea);
  const [possessionTimeline, setPossessionTimeline] = useState(initialPossessionTimeline);
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showBudgetPresets, setShowBudgetPresets] = useState(false);

  const cityOptions = useMemo(() => [
    { value: "All", label: "All Cities" },
    ...cities.map(c => ({ value: c, label: c }))
  ], [cities]);

  const hasActiveFilters = search || city !== "All" || bhk !== "All" || propertyType !== "All" ||
    minPrice || maxPrice || furnishing !== "All" || minArea || maxArea ||
    possessionTimeline !== "All" || sortBy !== "recommended";

  const updateParams = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === "All" || value === "" || value === "recommended") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    router.push(`/explore?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const debouncedSearchRef = useRef<((value: string) => void) | null>(null);

  // Always call the LATEST updateParams: it closes over `searchParams`, so a
  // debounce timer created on an earlier render must not navigate with a stale
  // query string (that would clobber filters the user set in the meantime).
  const updateParamsRef = useRef(updateParams);
  updateParamsRef.current = updateParams;

  if (!debouncedSearchRef.current) {
    let timeoutId: ReturnType<typeof setTimeout>;
    debouncedSearchRef.current = (value: string) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => updateParamsRef.current({ search: value }), 300);
    };
  }

  // Numeric filter inputs (price/area) used to push a navigation on EVERY
  // keystroke — each one triggered an RSC request + DB query for a number the
  // user was still typing ("5" → "50" → "500" → "5000"). Debounce per-field
  // with the same 300ms window as the free-text search.
  const numericTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const handleNumericChange = (
    key: "minPrice" | "maxPrice" | "minArea" | "maxArea",
    setter: (value: string) => void,
    value: string
  ) => {
    setter(value);
    const timers = numericTimersRef.current;
    const pending = timers.get(key);
    if (pending) clearTimeout(pending);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        updateParamsRef.current({ [key]: value });
      }, 300)
    );
  };

  const cancelPendingNumericUpdates = () => {
    numericTimersRef.current.forEach((t) => clearTimeout(t));
    numericTimersRef.current.clear();
  };

  useEffect(() => cancelPendingNumericUpdates, []);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    debouncedSearchRef.current?.(value);
  };

  const handleClearSearch = () => {
    setSearch("");
    updateParams({ search: "" });
  };

  const handleBudgetPreset = (min: number, max: number) => {
    const newMin = min === 0 ? "" : String(min);
    const newMax = max === 0 ? "" : String(max);
    cancelPendingNumericUpdates();
    setMinPrice(newMin);
    setMaxPrice(newMax);
    updateParams({ minPrice: newMin, maxPrice: newMax });
    setShowBudgetPresets(false);
  };

  const handleClearAll = () => {
    cancelPendingNumericUpdates();
    setSearch("");
    setCity("All");
    rememberCityPreference(null);
    setBhk("All");
    setPropertyType("All");
    setMinPrice("");
    setMaxPrice("");
    setFurnishing("All");
    setMinArea("");
    setMaxArea("");
    setPossessionTimeline("All");
    setSortBy("recommended");
    updateParams({
      search: "",
      city: "All",
      bhk: "All",
      propertyType: "All",
      minPrice: "",
      maxPrice: "",
      furnishing: "All",
      minArea: "",
      maxArea: "",
      possessionTimeline: "All",
      sortBy: "recommended",
    });
  };

  const activeFilters = [
    search && { key: "search", label: `Search: "${search}"`, onClear: handleClearSearch },
    city !== "All" && { key: "city", label: city, onClear: () => { setCity("All"); rememberCityPreference(null); updateParams({ city: "All" }); } },
    bhk !== "All" && { key: "bhk", label: bhk, onClear: () => { setBhk("All"); updateParams({ bhk: "All" }); } },
    propertyType !== "All" && { key: "propertyType", label: propertyType.replace("_", " "), onClear: () => { setPropertyType("All"); updateParams({ propertyType: "All" }); } },
    (minPrice || maxPrice) && { key: "budget", label: `${minPrice ? formatInrCompact(Number(minPrice)) : "Any"} - ${maxPrice ? formatInrCompact(Number(maxPrice)) : "Any"}`, onClear: () => { cancelPendingNumericUpdates(); setMinPrice(""); setMaxPrice(""); updateParams({ minPrice: "", maxPrice: "" }); } },
    furnishing !== "All" && { key: "furnishing", label: furnishing.replace("_", " "), onClear: () => { setFurnishing("All"); updateParams({ furnishing: "All" }); } },
    (minArea || maxArea) && { key: "area", label: `${minArea || "Any"} - ${maxArea || "Any"} sqft`, onClear: () => { cancelPendingNumericUpdates(); setMinArea(""); setMaxArea(""); updateParams({ minArea: "", maxArea: "" }); } },
    possessionTimeline !== "All" && { key: "possession", label: possessionTimeline, onClear: () => { setPossessionTimeline("All"); updateParams({ possessionTimeline: "All" }); } },
  ].filter(Boolean) as Array<{ key: string; label: string; onClear: () => void }>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col flex-wrap gap-3 sm:flex-row">
        <div className="relative flex-1 min-w-0">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/55" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search city, locality, sector, project or address"
            className="w-full min-w-0 appearance-none rounded-xl border border-white/15 bg-[var(--field)] pl-10 pr-10 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
          />
          {search && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/55 hover:text-white transition"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <Select
          value={city}
          options={cityOptions}
          onChange={(value) => {
            setCity(value);
            // Remember the chosen city so the homepage video showcase can
            // prioritise a property from it (first-party cookie, no precise
            // geolocation). "All" clears the preference.
            rememberCityPreference(value === "All" ? null : value);
            updateParams({ city: value });
          }}
          placeholder="All Cities"
          className="flex-1 sm:flex-none sm:w-48"
          aria-label="Filter by city"
        />

        <Select
          value={bhk}
          options={BHK_OPTIONS}
          onChange={(value) => { setBhk(value); updateParams({ bhk: value }); }}
          placeholder="Any BHK"
          className="flex-1 sm:flex-none sm:w-40"
          aria-label="Filter by BHK"
        />

        <Select
          value={propertyType}
          options={PROPERTY_TYPES}
          onChange={(value) => { setPropertyType(value); updateParams({ propertyType: value }); }}
          placeholder="All Types"
          className="flex-1 sm:flex-none sm:w-44"
          aria-label="Filter by property type"
        />

        <Select
          value={sortBy}
          options={SORT_OPTIONS}
          onChange={(value) => { setSortBy(value); updateParams({ sortBy: value }); }}
          placeholder="Recommended"
          className="flex-1 sm:flex-none sm:w-44"
          aria-label="Sort by"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <input
            type="text"
            value={minPrice}
            onChange={(e) => handleNumericChange("minPrice", setMinPrice, e.target.value)}
            placeholder="Min budget"
            className="w-full appearance-none rounded-xl border border-white/15 bg-[var(--field)] px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
            inputMode="numeric"
          />
        </div>
        <span className="text-white/55 px-2">–</span>
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <input
            type="text"
            value={maxPrice}
            onChange={(e) => handleNumericChange("maxPrice", setMaxPrice, e.target.value)}
            placeholder="Max budget"
            className="w-full appearance-none rounded-xl border border-white/15 bg-[var(--field)] px-4 py-2.5 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
            inputMode="numeric"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowBudgetPresets(!showBudgetPresets)}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/70 hover:border-[#d8a94e]/60 hover:text-white hover:bg-white/10 transition flex items-center gap-1.5"
        >
          Presets <ChevronDown size={14} />
        </button>

        <button
          type="button"
          onClick={() => setShowMoreFilters(!showMoreFilters)}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/70 hover:border-[#d8a94e]/60 hover:text-white hover:bg-white/10 transition flex items-center gap-1.5"
        >
          More Filters <ChevronDown size={14} className={showMoreFilters ? "rotate-180" : ""} />
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearAll}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/70 hover:border-[#d8a94e]/60 hover:text-white hover:bg-white/10 transition"
          >
            Clear All
          </button>
        )}
      </div>

      {showBudgetPresets && (
        <div className="flex flex-wrap gap-2 p-3 rounded-xl border border-white/10 bg-[var(--panel-soft)] animate-in fade-in slide-in-from-top-2">
          {BUDGET_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handleBudgetPreset(preset.min, preset.max)}
              className="rounded-lg border border-white/15 bg-[var(--field)] px-3 py-1.5 text-sm text-white/80 hover:border-[#d8a94e]/60 hover:text-white hover:bg-[var(--panel)] transition"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activeFilters.map((filter) => (
            <span key={filter.key} className="inline-flex items-center gap-1.5 rounded-full border border-[#d8a94e]/40 bg-[#d8a94e]/10 px-3 py-1 text-sm text-[#ffdf9e]">
              {filter.label}
              <button onClick={filter.onClear} className="ml-1 text-white/60 hover:text-white" aria-label={`Remove ${filter.label} filter`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {showMoreFilters && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 p-4 rounded-xl border border-white/10 bg-[var(--panel-soft)] animate-in fade-in slide-in-from-top-2">
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Furnishing</label>
            <Select
              value={furnishing}
              options={FURNISHING_OPTIONS}
              onChange={(value) => { setFurnishing(value); updateParams({ furnishing: value }); }}
              placeholder="Any Furnishing"
              className="w-full"
              aria-label="Filter by furnishing"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Min Area (sqft)</label>
            <input
              type="number"
              value={minArea}
              onChange={(e) => handleNumericChange("minArea", setMinArea, e.target.value)}
              placeholder="e.g. 1000"
              className="w-full appearance-none rounded-xl border border-white/15 bg-[var(--field)] px-4 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
              inputMode="numeric"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Max Area (sqft)</label>
            <input
              type="number"
              value={maxArea}
              onChange={(e) => handleNumericChange("maxArea", setMaxArea, e.target.value)}
              placeholder="e.g. 3000"
              className="w-full appearance-none rounded-xl border border-white/15 bg-[var(--field)] px-4 py-2 text-sm text-white outline-none focus:border-[#d8a94e]/60 focus:ring-4 focus:ring-[#d8a94e]/15 placeholder-white/30"
              inputMode="numeric"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Possession</label>
            <Select
              value={possessionTimeline}
              options={POSSESSION_OPTIONS}
              onChange={(value) => { setPossessionTimeline(value); updateParams({ possessionTimeline: value }); }}
              placeholder="Any Possession"
              className="w-full"
              aria-label="Filter by possession timeline"
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-white/50">
        <span>{resultCount} propert{resultCount !== 1 ? "ies" : "y"} found</span>
        {isLoading && <Loader2 size={16} className="animate-spin text-[#d8a94e]" />}
      </div>
    </div>
  );
}