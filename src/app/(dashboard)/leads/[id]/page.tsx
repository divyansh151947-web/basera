import { getCurrentSession } from "@/lib/auth";
import { getLeadById } from "@/lib/data/leads";
import { listTeam } from "@/lib/data/org";
import { db } from "@/db/client";
import { conversations, messages } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { matchProperties } from "@/lib/ai/property-matching";
import { getRecoveryTimeline } from "@/lib/revenue-recovery-autopilot";
import { TempBadge, StatusBadge } from "@/components/ui";
import { formatBudgetRange } from "@/lib/formatters";
import { notFound, redirect } from "next/navigation";
import LeadControls from "./lead-controls";

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;
  const lead = await getLeadById(organizationId, params.id);
  if (!lead) notFound();

  const [team, matches, convo, timeline] = await Promise.all([
    listTeam(organizationId),
    matchProperties(organizationId, lead, 5),
    db.select().from(conversations).where(eq(conversations.leadId, lead.id)).orderBy(desc(conversations.updatedAt)).limit(1),
    getRecoveryTimeline(organizationId, lead.id),
  ]);
  const assignedAgent = team.find((m) => m.id === lead.assignedAgentId);

  const msgs = convo[0] ? await db.select().from(messages).where(eq(messages.conversationId, convo[0].id)) : [];

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink">{lead.name ?? "Unnamed lead"}</h1>
          <p className="text-sm text-slate2 mt-1">{lead.phone ?? "—"} {lead.email ? `· ${lead.email}` : ""}</p>
          <div className="flex items-center gap-2 mt-2">
            <TempBadge temperature={lead.temperature} />
            <StatusBadge status={lead.status} />
            <span className="text-sm text-slate2">Score {lead.score}/100</span>
          </div>
        </div>
      </div>

      {/* grid-cols-1 keeps the below-md track minmax(0,1fr): without it the
          implicit track sized to content min-width (~421px) and the page
          overflowed horizontally on every phone width. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
        <div className="md:col-span-2 space-y-6">
          {lead.aiSummary && (
            <div className="rounded-lg border border-line bg-panel p-5">
              <h2 className="text-sm font-semibold text-ink mb-2">AI summary</h2>
              <pre className="whitespace-pre-wrap text-sm text-ink font-sans">{lead.aiSummary}</pre>
            </div>
          )}

          <div className="rounded-lg border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">Conversation</h2>
            {msgs.length === 0 && <p className="text-sm text-slate2">No conversation yet.</p>}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {msgs.map((m) => (
                <div key={m.id} className={`flex ${m.sender === "LEAD" ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    m.sender === "LEAD" ? "bg-paper text-ink" : m.sender === "AGENT" ? "bg-gold-light text-ink" : "bg-brand-light text-ink"
                  }`}>
                    <p className="text-[10px] uppercase tracking-wide text-slate2 mb-0.5">{m.sender}</p>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>
            {convo[0] && <LeadControls conversationId={convo[0].id} leadId={lead.id} team={team} lead={lead} />}
          </div>

          <div className="rounded-lg border border-line bg-panel p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">Matching properties in inventory</h2>
            {matches.length === 0 && <p className="text-sm text-slate2">No matches found yet — add properties or more requirements.</p>}
            <div className="space-y-2">
              {matches.map((m) => (
                <div key={m.property.id} className="flex items-center justify-between border border-line rounded-md px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-ink">{m.property.projectName}</p>
                    <p className="text-xs text-slate2">{m.property.locality}, {m.property.city} · {m.property.bhk ?? "—"} BHK · {formatBudgetRange(m.property.priceMinInr, m.property.priceMaxInr)}</p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.matchType === "EXACT" ? "bg-brand-light text-brand" : m.matchType === "CLOSE" ? "bg-gold-light text-gold" : "bg-paper text-slate2"}`}>
                    {m.matchType} · {m.matchScore}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-panel p-4 text-sm">
            <h2 className="text-sm font-semibold text-ink mb-2">Requirement</h2>
            <dl className="space-y-1.5 text-ink">
              <Row label="City" value={lead.preferredCity} />
              <Row label="Locality" value={lead.preferredLocality} />
              <Row label="BHK" value={lead.bhk?.toString()} />
              <Row label="Type" value={lead.propertyType ?? undefined} />
              <Row label="Budget" value={formatBudgetRange(lead.budgetMinInr, lead.budgetMaxInr)} />
              <Row label="Purpose" value={lead.purpose ?? undefined} />
              <Row label="Timeline" value={lead.timeline ?? undefined} />
              <Row label="Loan" value={lead.loanRequired == null ? undefined : lead.loanRequired ? "Required" : "Not required"} />
              <Row label="Site visit" value={lead.siteVisitInterest ? "Interested" : undefined} />
              <Row label="Source" value={lead.source} />
            </dl>
          </div>
          <div className="rounded-lg border border-line bg-panel p-4 text-sm">
            <h2 className="text-sm font-semibold text-ink mb-2">Management</h2>
            <dl className="space-y-1.5 text-ink">
              <Row label="Assigned" value={assignedAgent ? `${assignedAgent.name} (${assignedAgent.role.replace(/_/g, " ").toLowerCase()})` : "Unassigned"} />
              <Row label="Last contact" value={lead.lastContactAt ? new Date(lead.lastContactAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"} />
              <Row label="Next follow-up" value={lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—"} />
              <Row label="Status" value={lead.status.replace(/_/g, " ").toLowerCase()} />
            </dl>
          </div>
          <div className="rounded-lg border border-line bg-panel p-4 text-sm">
            <h2 className="text-sm font-semibold text-ink mb-2">Recovery timeline</h2>
            <p className="text-xs text-slate2 mb-3">Recorded events only — no history is inferred.</p>
            {!timeline || timeline.events.length === 0 ? (
              <p className="text-sm text-slate2">No recovery events recorded yet.</p>
            ) : (
              <ol className="space-y-2.5">
                {timeline.events.slice(-12).map((e, i) => (
                  <li key={`${e.at}-${e.kind}-${i}`} className="border-l-2 border-line pl-3">
                    <p className="font-medium text-ink text-[13px]">{e.title}</p>
                    <p className="text-xs text-slate2">{e.detail}</p>
                    <p className="text-[11px] text-slate2">{new Date(e.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate2">{label}</dt>
      <dd className="font-medium text-right">{value ?? "—"}</dd>
    </div>
  );
}
