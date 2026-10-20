import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { listConversations } from "@/lib/data/conversations";
import { getLeadById } from "@/lib/data/leads";

export default async function ConversationsPage({ searchParams }: { searchParams: { channel?: string } }) {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;
  const rows = await listConversations(organizationId);
  const filtered = searchParams.channel ? rows.filter((row) => row.channel === searchParams.channel) : rows;
  const entries = await Promise.all(filtered.map(async (conversation) => ({ conversation, lead: await getLeadById(organizationId, conversation.leadId) })));
  return (
    <div className="space-y-6">
      <div>
        <span className="eyebrow">Inbox</span>
        <h1 className="mt-3 font-display text-3xl text-ink">Conversations</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/conversations" data-active={!searchParams.channel} className="filter-pill">All</Link>
        {["WEBSITE_CHAT", "WHATSAPP"].map((channel) => (
          <Link key={channel} href={`/conversations?channel=${channel}`} data-active={searchParams.channel === channel} className="filter-pill">
            {channel === "WHATSAPP" ? "WhatsApp" : "Website"}
          </Link>
        ))}
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ conversation, lead }) => (
          <Link key={conversation.id} href={`/conversations/${conversation.id}`} className="panel-surface p-5">
            <div className="flex items-center justify-between gap-3"><p className="text-lg font-semibold text-ink">{lead?.name ?? lead?.phone ?? "Unnamed lead"}</p><span className="badge">{conversation.channel === "WHATSAPP" ? "WhatsApp" : "Website"}</span></div>
            <p className="mt-3 text-sm leading-6 text-slate">Score {lead?.score ?? 0} · {lead?.temperature ?? "COLD"} · {conversation.status.replace(/_/g, " ").toLowerCase()}</p>
            {conversation.handoffReason && <p className="mt-2 text-xs text-danger">Handoff: {conversation.handoffReason}</p>}
          </Link>
        ))}
        {entries.length === 0 && (
          <div className="empty-state sm:col-span-2 lg:col-span-3">No conversations in this channel yet.</div>
        )}
      </div>
    </div>
  );
}
