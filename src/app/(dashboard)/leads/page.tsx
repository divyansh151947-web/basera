import Link from "next/link";
import { getCurrentSession } from "@/lib/auth";
import { listLeads } from "@/lib/data/leads";
import { TempBadge, StatusBadge, formatInr } from "@/components/ui";
import NewLeadButton from "./new-lead-button";

export default async function LeadsPage({ searchParams }: { searchParams: { status?: string; temperature?: string } }) {
  const session = await getCurrentSession();
  const organizationId = (session!.user as any).organizationId as string;
  const leads = await listLeads(organizationId, { status: searchParams.status, temperature: searchParams.temperature });

  const filterLink = (params: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    Object.entries({ ...searchParams, ...params }).forEach(([k, v]) => v && usp.set(k, v));
    return `/leads?${usp.toString()}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink">Leads</h1>
          <p className="text-sm text-slate2 mt-1">{leads.length} lead{leads.length !== 1 ? "s" : ""}</p>
        </div>
        <NewLeadButton />
      </div>

      <div className="flex gap-2 mt-4 flex-wrap">
        {["HOT", "WARM", "COLD"].map((t) => (
          <Link key={t} href={filterLink({ temperature: searchParams.temperature === t ? undefined : t })}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${searchParams.temperature === t ? "bg-ink text-white border-ink" : "border-line text-slate2 hover:bg-panel"}`}>
            {t}
          </Link>
        ))}
        {["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT_SCHEDULED", "NEGOTIATION", "CONVERTED", "LOST"].map((s) => (
          <Link key={s} href={filterLink({ status: searchParams.status === s ? undefined : s })}
            className={`px-3 py-1 rounded-full text-xs font-medium border ${searchParams.status === s ? "bg-ink text-white border-ink" : "border-line text-slate2 hover:bg-panel"}`}>
            {s.replace(/_/g, " ").toLowerCase()}
          </Link>
        ))}
      </div>

      <div className="mt-5 rounded-lg border border-line bg-panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-paper text-slate2 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Lead</th>
              <th className="text-left px-4 py-2.5 font-medium">Requirement</th>
              <th className="text-left px-4 py-2.5 font-medium">Budget</th>
              <th className="text-left px-4 py-2.5 font-medium">Score</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 font-medium">Source</th>
              <th className="text-left px-4 py-2.5 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} className="border-t border-line hover:bg-paper/60">
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-ink hover:text-brand">{lead.name ?? "Unnamed lead"}</Link>
                  <p className="text-xs text-slate2">{lead.phone ?? lead.email ?? "No contact info"}</p>
                </td>
                <td className="px-4 py-3 text-ink">{lead.bhk ? `${lead.bhk} BHK` : "—"} {lead.preferredCity ? `· ${lead.preferredCity}` : ""}</td>
                <td className="px-4 py-3 text-ink">{lead.budgetMinInr || lead.budgetMaxInr ? `${formatInr(lead.budgetMinInr)}–${formatInr(lead.budgetMaxInr)}` : "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{lead.score}</span>
                    <TempBadge temperature={lead.temperature} />
                  </div>
                </td>
                <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                <td className="px-4 py-3 text-slate2">{lead.source.replace(/_/g, " ").toLowerCase()}</td>
                <td className="px-4 py-3 text-slate2">{new Date(lead.updatedAt).toLocaleDateString("en-IN")}</td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate2">No leads match these filters yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
