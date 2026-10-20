import "server-only";
import { TenantAuthError } from "./tenant";
import { listTeam } from "./data/org";

/**
 * LEAD AUTHORIZATION (Batch 1B-4).
 *
 * Tenant isolation (organizationId scoping in every query) is unchanged and
 * remains the primary boundary — nothing here can ever cross organizations.
 * This module adds the SECOND layer inside an organization, using the
 * existing roles without inventing a new hierarchy:
 *
 * - BUSINESS_ADMIN / MANAGER ("managers"): full organization-wide lead
 *   access — view, create, update any org lead, and manage assignments.
 * - SALES_AGENT ("agents"): may read and update leads that are assigned to
 *   them or are unassigned. Leads assigned to another agent are forbidden
 *   (403). Assignment changes of any kind are manager-only.
 * - SUPER_ADMIN: unchanged — platform-wide, no organization session, so
 *   requireTenant() still rejects org-scoped access (existing behavior).
 *
 * Assignment targets are always verified against the organization's own
 * team roster (never trusted from the request), preventing cross-org
 * assignment references. Request bodies cannot smuggle organizationId,
 * userId, or role — no validation schema accepts those fields.
 */

export const MANAGER_ROLES = ["BUSINESS_ADMIN", "MANAGER"] as const;

/** Managers operate organization-wide; everyone else is assignment-scoped. */
export function canManageAllLeads(role: string): boolean {
  return (MANAGER_ROLES as readonly string[]).includes(role);
}

export interface AssignedRow {
  assignedAgentId?: string | null;
}

/** Pure check: is this caller allowed to read/mutate this lead row? */
export function isLeadAuthorized(role: string, userId: string, lead: AssignedRow | null): boolean {
  if (!lead) return false;
  if (canManageAllLeads(role)) return true;
  return !lead.assignedAgentId || lead.assignedAgentId === userId;
}

/** Throwing variant used by API routes (403, never existence-revealing). */
export function requireLeadAccess(role: string, userId: string, lead: AssignedRow | null): void {
  if (!isLeadAuthorized(role, userId, lead)) {
    throw new TenantAuthError("Not authorized to access this lead", 403);
  }
}

/**
 * Assignment changes are manager-only, and the target must be a member of
 * the SAME organization (verified server-side against the team roster).
 * Passing null (unassign) skips the roster check but still requires a
 * manager. Throws 403 for role violations, 404 for foreign/unknown targets
 * (matching the appointments-route convention, revealing nothing).
 */
export async function requireAssignmentPermission(
  role: string,
  organizationId: string,
  targetAgentId: string | null | undefined
): Promise<void> {
  if (!canManageAllLeads(role)) {
    throw new TenantAuthError("Only managers can change lead assignment", 403);
  }
  if (targetAgentId == null) return;
  const team = await listTeam(organizationId);
  if (!team.some((m) => m.id === targetAgentId)) {
    throw new TenantAuthError("Agent not found in this organization", 404);
  }
}
