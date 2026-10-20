import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { listAppointments } from "@/lib/data/org";
import { getLeadById } from "@/lib/data/leads";
import { getPropertyById } from "@/lib/data/properties";
import { listTeam } from "@/lib/data/org";

export default async function AppointmentsPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/login");
  const organizationId = (session.user as any).organizationId as string;

  const rows = await listAppointments(organizationId);
  const team = await listTeam(organizationId);
  const agentNameById = new Map(team.map((m) => [m.id, m.name]));

  const entries = await Promise.all(
    rows.map(async (a) => ({
      appointment: a,
      lead: await getLeadById(organizationId, a.leadId).catch(() => null),
      property: a.propertyId ? await getPropertyById(organizationId, a.propertyId).catch(() => null) : null,
    }))
  );

  return (
    <div className="space-y-6">
      <div>
        <span className="eyebrow">Scheduling</span>
        <h1 className="mt-3 font-display text-3xl text-ink">Appointments</h1>
        <p className="mt-2 text-sm text-slate">
          {entries.length} appointment{entries.length !== 1 ? "s" : ""} scheduled.
        </p>
      </div>

      {entries.length === 0 && (
        <div className="panel-surface p-10 text-center text-sm text-slate">
          No appointments yet. Book a site visit from a lead or conversation and it will appear here.
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {entries.map(({ appointment, lead, property }) => (
          <div key={appointment.id} className="panel-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-semibold text-ink">
                {appointment.type === "SITE_VISIT" ? "Site visit" : appointment.type === "CALL" ? "Call" : "Meeting"}
                {property ? ` · ${property.projectName}` : ""}
              </p>
              <span className="rounded-full border border-brand/20 bg-brand-soft px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-brand">
                {appointment.status.replace("_", " ")}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate">
              {new Date(appointment.scheduledAt).toLocaleString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
            <p className="mt-2 text-sm font-medium text-ink">
              Lead:{" "}
              {lead ? (
                <Link href={`/leads/${lead.id}`} className="text-brand hover:underline">
                  {lead.name ?? lead.phone ?? "View lead"}
                </Link>
              ) : (
                "—"
              )}
            </p>
            {appointment.agentId && (
              <p className="mt-1 text-sm text-slate">Agent: {agentNameById.get(appointment.agentId) ?? "Assigned"}</p>
            )}
            {appointment.notes && <p className="mt-2 text-sm text-slate">{appointment.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
