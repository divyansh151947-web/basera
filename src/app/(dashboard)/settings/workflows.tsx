import { getCurrentSession } from "@/lib/auth";
import { listWorkflowDefinitions } from "@/lib/data/workflows";
import { WorkflowManager } from "@/components/workflow-manager";

/**
 * Workflows panel (Feature 5: automated sales workflows).
 * Server component — fetches the caller's organization workflow definitions
 * and passes them to the client builder. Restricted to BUSINESS_ADMIN /
 * SUPER_ADMIN via middleware on /settings.
 */
export default async function Workflows() {
  const session = await getCurrentSession();
  if (!session?.user) return null;
  const organizationId = (session.user as any).organizationId as string;
  const role = (session.user as any).role as string;
  if (!["BUSINESS_ADMIN", "SUPER_ADMIN"].includes(role)) return null;

  const workflows = await listWorkflowDefinitions(organizationId);

  return (
    <div className="panel-surface p-5">
      <h2 className="text-sm font-semibold text-ink mb-3">Automated Workflows</h2>
      <p className="text-xs text-slate2 mb-4">
        Configure rules that trigger follow-ups, tasks, and escalations
        automatically based on lead activity.
      </p>
      <WorkflowManager initialWorkflows={workflows} organizationId={organizationId} />
    </div>
  );
}
