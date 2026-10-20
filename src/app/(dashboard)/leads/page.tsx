import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { listLeads } from "@/lib/data/leads";
import { formatBudgetRange } from "@/lib/formatters";
import { TempBadge, StatusBadge } from "@/components/ui";
import NewLeadButton from "./new-lead-button";

export default async function LeadsPage({ searchParams }: { searchParams: { status?: string; temperature?: string } }) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;
  const leads = await listLeads(organizationId, { status: searchParams.status, temperature: searchParams.temperature });

  const filterLink = (params: Record<string, string | undefined>) => {
    const usp = new URLSearchParams();
    Object.entries({ ...searchParams, ...params }).forEach(([k, v]) => v && usp.set(k, v));
    return `/leads?${usp.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="eyebrow">CRM</span>
          <h1 className="mt-3 font-display text-3xl text-ink">Leads</h1>
          <p className="mt-2 text-sm text-slate">{leads.length} lead{leads.length !== 1 ? "s" : ""}</p>
        </div>
        <NewLeadButton />
      </div>

      <div className="flex flex-wrap gap-2">
        {['HOT', 'WARM', 'COLD'].map((t) => (
          <Link
            key={t}
            href={filterLink({ temperature: searchParams.temperature === t ? undefined : t })}
            data-active={searchParams.temperature === t}
            className="filter-pill"
          >
            {t}
          </Link>
        ))}
        {['NEW', 'CONTACTED', 'QUALIFIED', 'SITE_VISIT_SCHEDULED', 'NEGOTIATION', 'CONVERTED', 'LOST'].map((s) => (
          <Link
            key={s}
            href={filterLink({ status: searchParams.status === s ? undefined : s })}
            data-active={searchParams.status === s}
            className="filter-pill"
          >
            {s.replace(/_/g, ' ').toLowerCase()}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-panel shadow-card">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-panel-soft text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate">
              <tr>
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Requirement</th>
                <th className="px-4 py-3">Budget</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-t border-line align-top transition-colors hover:bg-panel-soft">
                  <td className="px-4 py-4">
                    <Link href={`/leads/${lead.id}`} className="font-semibold text-ink hover:text-brand">{lead.name ?? 'Unnamed lead'}</Link>
                    <p className="mt-1 text-xs text-slate">{lead.phone ?? lead.email ?? 'No contact info'}</p>
                  </td>
                  <td className="px-4 py-4 text-ink">
                    {lead.bhk ? `${lead.bhk} BHK` : '—'} {lead.preferredCity ? `· ${lead.preferredCity}` : ''}
                  </td>
                  <td className="px-4 py-4 text-ink">
                    {formatBudgetRange(lead.budgetMinInr, lead.budgetMaxInr)}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{lead.score}</span>
                      <TempBadge temperature={lead.temperature} />
                    </div>
                  </td>
                  <td className="px-4 py-4"><StatusBadge status={lead.status} /></td>
                  <td className="px-4 py-4 text-slate">{lead.source.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="px-4 py-4 text-slate">{new Date(lead.updatedAt).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center text-slate">No leads match these filters yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
