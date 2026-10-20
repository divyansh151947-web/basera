import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { getConversation, getMessages } from "@/lib/data/conversations";
import { getLeadById } from "@/lib/data/leads";
import { matchProperties } from "@/lib/ai/property-matching";
import { formatBudgetRange } from "@/lib/formatters";
import { TempBadge, StatusBadge } from "@/components/ui";

export default async function ConversationDetailPage({ params }: { params: { id: string } }) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;

  const conversation = await getConversation(organizationId, params.id);
  if (!conversation) notFound();

  const [lead, msgs] = await Promise.all([
    getLeadById(organizationId, conversation.leadId),
    getMessages(conversation.id),
  ]);
  const matches = lead ? await matchProperties(organizationId, lead, 3) : [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/conversations" className="text-sm font-medium text-brand hover:underline">
          ← All conversations
        </Link>
        <h1 className="mt-3 font-display text-2xl text-ink">{lead?.name ?? lead?.phone ?? "Conversation"}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate">
          <span className="rounded-full border border-line bg-[var(--panel-soft)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.09em]">
            {conversation.channel === "WHATSAPP" ? "WhatsApp" : "Website"}
          </span>
          <span>{conversation.status.replace(/_/g, " ").toLowerCase()}</span>
          {lead && (
            <>
              <TempBadge temperature={lead.temperature} />
              <StatusBadge status={lead.status} />
              <span>Score {lead.score}/100</span>
            </>
          )}
        </div>
        {conversation.handoffReason && (
          <p className="mt-2 text-sm text-danger">Handoff: {conversation.handoffReason}</p>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel-surface p-5">
          <h2 className="text-sm font-semibold text-ink">Messages</h2>
          {msgs.length === 0 && <p className="mt-3 text-sm text-slate">No messages yet.</p>}
          <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto">
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.sender === "LEAD" ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    m.sender === "LEAD" ? "bg-paper text-ink" : m.sender === "AGENT" ? "bg-gold-light text-ink" : "bg-brand-light text-ink"
                  }`}
                >
                  <p className="mb-0.5 text-[10px] uppercase tracking-wide text-slate">{m.sender}</p>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          {lead && (
            <div className="panel-surface p-5 text-sm">
              <h2 className="text-sm font-semibold text-ink">Customer</h2>
              <dl className="mt-3 space-y-1.5">
                <div className="flex justify-between gap-2"><dt className="text-slate">Source</dt><dd className="font-medium">{lead.source}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate">City</dt><dd className="font-medium">{lead.preferredCity ?? "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate">BHK</dt><dd className="font-medium">{lead.bhk ?? "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate">Budget</dt><dd className="font-medium">{formatBudgetRange(lead.budgetMinInr, lead.budgetMaxInr)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate">Timeline</dt><dd className="font-medium">{lead.timeline ?? "—"}</dd></div>
              </dl>
              <Link href={`/leads/${lead.id}`} className="mt-4 inline-block font-medium text-brand hover:underline">
                Open lead →
              </Link>
              {lead.aiSummary && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate">AI summary</p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-ink">{lead.aiSummary}</pre>
                </div>
              )}
            </div>
          )}
          <div className="panel-surface p-5 text-sm">
            <h2 className="text-sm font-semibold text-ink">Matched properties</h2>
            {matches.length === 0 && <p className="mt-2 text-slate">No verified matches yet.</p>}
            <div className="mt-3 space-y-2">
              {matches.map((m) => (
                <div key={m.property.id} className="rounded-lg border border-line px-3 py-2">
                  <p className="font-medium text-ink">{m.property.projectName}</p>
                  <p className="text-xs text-slate">
                    {m.property.locality}, {m.property.city} · {m.matchType} · {m.matchScore}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
