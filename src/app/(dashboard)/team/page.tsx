import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { listTeam } from "@/lib/data/org";
import { db } from "@/db/client";
import { leads } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function TeamPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;

  const [team, leadRows] = await Promise.all([
    listTeam(organizationId),
    db.select().from(leads).where(eq(leads.organizationId, organizationId)),
  ]);

  const activeByAgent = new Map<string, number>();
  for (const lead of leadRows) {
    if (lead.assignedAgentId && !["CONVERTED", "LOST"].includes(lead.status)) {
      activeByAgent.set(lead.assignedAgentId, (activeByAgent.get(lead.assignedAgentId) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <span className="eyebrow">People</span>
        <h1 className="mt-3 font-display text-3xl text-ink">Sales team</h1>
        <p className="mt-2 text-sm text-slate">
          {team.length} member{team.length !== 1 ? "s" : ""} in this organization. New members join via signup or admin invite.
        </p>
      </div>

      {team.length === 0 && (
        <div className="panel-surface p-10 text-center text-sm text-slate">
          No team members yet. Share your signup link with your sales team to add them.
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {team.map((member) => {
          const active = activeByAgent.get(member.id) ?? 0;
          return (
            <div key={member.id} className="panel-surface p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-base font-semibold text-brand">
                  {member.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-lg font-semibold text-ink">{member.name}</p>
                  <p className="text-sm text-slate">
                    {member.role.replace("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} · {member.email}
                  </p>
                </div>
              </div>
              <p className="mt-4 text-sm text-slate">
                {active} active lead{active !== 1 ? "s" : ""} assigned
                {!member.isActive ? " · Deactivated" : ""}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
