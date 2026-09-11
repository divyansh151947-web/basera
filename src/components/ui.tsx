export function formatInr(n?: number | null) {
  if (n == null) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <p className="text-xs font-medium text-slate2 uppercase tracking-wide">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold ${accent ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

const TEMP_STYLES: Record<string, string> = {
  HOT: "bg-hot/10 text-hot border-hot/30",
  WARM: "bg-warm/10 text-warm border-warm/30",
  COLD: "bg-cold/10 text-cold border-cold/30",
};

export function TempBadge({ temperature }: { temperature: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${TEMP_STYLES[temperature] ?? ""}`}>
      {temperature}
    </span>
  );
}

const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  INTERESTED: "Interested",
  SITE_VISIT_SCHEDULED: "Site visit scheduled",
  NEGOTIATION: "Negotiation",
  CONVERTED: "Converted",
  LOST: "Lost",
  NURTURE: "Nurture",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-paper border border-line text-ink">{STATUS_LABEL[status] ?? status}</span>;
}
