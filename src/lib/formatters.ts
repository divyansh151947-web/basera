export function formatInr(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatBudgetRange(minValue?: number | null, maxValue?: number | null): string {
  const hasMin = minValue != null && Number.isFinite(minValue);
  const hasMax = maxValue != null && Number.isFinite(maxValue);

  if (!hasMin && !hasMax) return "—";
  if (hasMin && hasMax) return `${formatInr(minValue)}–${formatInr(maxValue)}`;
  if (hasMin) return `From ${formatInr(minValue)}`;
  return `Up to ${formatInr(maxValue)}`;
}

/**
 * Display dates for hydrated UI. Locale AND timezone are pinned so server
 * render and client hydration always produce the identical string —
 * bare toLocaleDateString() differs by runtime default (e.g. Node
 * "16/10/2026" vs Chrome "10/16/2026") and triggers React hydration #425.
 * Output matches the previous server-side rendering (DD/MM/YYYY).
 */
export function formatDisplayDate(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { timeZone: "UTC" });
}

/** Date + time variant of formatDisplayDate (same determinism guarantee). */
export function formatDisplayDateTime(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("en-IN", { timeZone: "UTC" }) +
    " at " +
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
  );
}
