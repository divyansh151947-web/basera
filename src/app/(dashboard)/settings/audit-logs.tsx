import { getCurrentSession } from "@/lib/auth";
import { listAuditLogs, listTeam } from "@/lib/data/org";

/**
 * Audit logs panel (Feature 7: enterprise workspace management).
 * Server component — reads the caller's organization from the session and
 * displays recent administrative/audit activity. Only meaningful for
 * BUSINESS_ADMIN / SUPER_ADMIN, who are the only roles that can reach
 * /settings (middleware-enforced).
 */
export default async function AuditLogs() {
  const session = await getCurrentSession();
  if (!session?.user) return null;
  const organizationId = (session.user as any).organizationId as string;
  const role = (session.user as any).role as string;
  if (!["BUSINESS_ADMIN", "SUPER_ADMIN"].includes(role)) return null;

  const [logs, team] = await Promise.all([
    listAuditLogs(organizationId, 50),
    listTeam(organizationId),
  ]);
  const nameById = new Map(team.map((u) => [u.id, u.name]));

  if (logs.length === 0) {
    return (
      <div className="panel-surface p-5">
        <h2 className="text-sm font-semibold text-ink mb-3">Workspace audit log</h2>
        <p className="text-sm text-slate2">No administrative actions recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="panel-surface p-5">
      <h2 className="text-sm font-semibold text-ink mb-3">Workspace audit log</h2>
      <p className="text-xs text-slate2 mb-4">Recent administrative actions in this workspace.</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border-collapse">
          <thead>
            <tr className="bg-panel-soft text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Entity ID</th>
            </tr>
          </thead>
          <tbody className="text-slate2 divide-y divide-line">
            {logs.map((l) => (
              <tr key={l.id} className="text-[12px]">
                <td className="px-4 py-3">{new Date(l.createdAt).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}</td>
                <td className="px-4 py-3 font-medium text-ink">{nameById.get(l.userId ?? "") ?? "System"}</td>
                <td className="px-4 py-3">{l.action.replace(/_/g, " ").toLowerCase()}</td>
                <td className="px-4 py-3">{l.entityType ?? "—"}</td>
                <td className="px-4 py-3 truncate max-w-[120px]">{l.entityId ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
