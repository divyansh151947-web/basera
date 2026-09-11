import "server-only";
import { getCurrentSession } from "./auth";

/**
 * TENANT ISOLATION — SINGLE CHOKEPOINT
 * ------------------------------------------------------------------
 * Every server action / API route that touches business data MUST call
 * requireTenant() to get the caller's organizationId, and MUST pass that
 * value into the corresponding WHERE clause of every query (see
 * src/lib/data/*.ts, which all take organizationId as their first arg).
 *
 * Never trust an organizationId passed in the request body/query string —
 * always derive it from the authenticated session server-side. This is the
 * #1 defense against Business A reading Business B's data.
 *
 * SUPER_ADMIN is the only role allowed to act platform-wide (no single
 * organizationId); it uses requireSuperAdmin() instead and every platform
 * query it runs is explicitly for cross-tenant admin views (org list,
 * usage, billing) — never for reading into a single tenant's CRM data.
 */

export class TenantAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function requireTenant() {
  const session = await getCurrentSession();
  if (!session?.user) throw new TenantAuthError("Not authenticated", 401);
  const { organizationId, role, id } = session.user as any;
  if (!organizationId) throw new TenantAuthError("No organization on this account", 403);
  return { organizationId: organizationId as string, role: role as string, userId: id as string };
}

export async function requireRole(minRoles: string[]) {
  const ctx = await requireTenant();
  if (!minRoles.includes(ctx.role)) throw new TenantAuthError("Insufficient permissions", 403);
  return ctx;
}

export async function requireSuperAdmin() {
  const session = await getCurrentSession();
  if (!session?.user || (session.user as any).role !== "SUPER_ADMIN") {
    throw new TenantAuthError("Super admin only", 403);
  }
  return { userId: (session.user as any).id as string };
}
