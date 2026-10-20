import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MANAGER_ROLES,
  canManageAllLeads,
  isLeadAuthorized,
  requireAssignmentPermission,
  requireLeadAccess,
} from "./lead-access";
import { TenantAuthError } from "./tenant";

describe("lead authorization model", () => {
  it("managers operate organization-wide", () => {
    expect(MANAGER_ROLES).toContain("BUSINESS_ADMIN");
    expect(MANAGER_ROLES).toContain("MANAGER");
    expect(canManageAllLeads("BUSINESS_ADMIN")).toBe(true);
    expect(canManageAllLeads("MANAGER")).toBe(true);
    expect(canManageAllLeads("SALES_AGENT")).toBe(false);
    expect(canManageAllLeads("SUPER_ADMIN")).toBe(false);
    expect(canManageAllLeads("anything-else")).toBe(false);
  });

  it("admin: organization-wide lead access (scenario 1)", () => {
    expect(isLeadAuthorized("BUSINESS_ADMIN", "admin-1", { assignedAgentId: "someone-else" })).toBe(true);
    expect(isLeadAuthorized("MANAGER", "mgr-1", { assignedAgentId: null })).toBe(true);
    expect(isLeadAuthorized("BUSINESS_ADMIN", "admin-1", null)).toBe(false);
  });

  it("agent: own and unassigned leads allowed (scenario 2)", () => {
    expect(isLeadAuthorized("SALES_AGENT", "agent-1", { assignedAgentId: "agent-1" })).toBe(true);
    expect(isLeadAuthorized("SALES_AGENT", "agent-1", { assignedAgentId: null })).toBe(true);
    expect(isLeadAuthorized("SALES_AGENT", "agent-1", {})).toBe(true);
  });

  it("agent: colleague-assigned lead rejected (scenario 3)", () => {
    expect(isLeadAuthorized("SALES_AGENT", "agent-1", { assignedAgentId: "agent-2" })).toBe(false);
    expect(() => requireLeadAccess("SALES_AGENT", "agent-1", { assignedAgentId: "agent-2" })).toThrowError(TenantAuthError);
    try {
      requireLeadAccess("SALES_AGENT", "agent-1", { assignedAgentId: "agent-2" });
      expect.unreachable();
    } catch (err) {
      expect((err as TenantAuthError).status).toBe(403);
    }
  });

  it("agents cannot change assignment, even to themselves (scenarios 7/11)", async () => {
    await expect(requireAssignmentPermission("SALES_AGENT", "org-1", "agent-1")).rejects.toMatchObject({ status: 403 });
    await expect(requireAssignmentPermission("SALES_AGENT", "org-1", null)).rejects.toMatchObject({ status: 403 });
  });

  it("unknown targets are rejected without reaching the roster (scenario 9 shape)", async () => {
    // Manager role passes the role gate; an org with no such member yields 404.
    await expect(requireAssignmentPermission("BUSINESS_ADMIN", "org-that-cannot-exist", "ghost")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("unassign (null target) is manager-only and needs no roster lookup", async () => {
    await expect(requireAssignmentPermission("BUSINESS_ADMIN", "org-1", null)).resolves.toBeUndefined();
    await expect(requireAssignmentPermission("MANAGER", "org-1", undefined)).resolves.toBeUndefined();
  });
});
