import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/db/client";
import {
  organizations,
  users,
  workflowDefinitions,
  workflowExecutions,
  leads,
} from "@/db/schema";
import {
  createWorkflowDefinition,
  deleteWorkflowDefinition,
  getWorkflowDefinition,
  listWorkflowDefinitions,
  listWorkflowExecutions,
  recordWorkflowExecution,
  updateWorkflowDefinition,
} from "./workflows";

const ORG = "wf-test-org";
const OTHER_ORG = "wf-test-org-2";

async function wipe() {
  await db.delete(workflowExecutions).where(eq(workflowExecutions.organizationId, ORG));
  await db.delete(workflowExecutions).where(eq(workflowExecutions.organizationId, OTHER_ORG));
  await db.delete(workflowDefinitions).where(eq(workflowDefinitions.organizationId, ORG));
  await db.delete(workflowDefinitions).where(eq(workflowDefinitions.organizationId, OTHER_ORG));
  await db.delete(leads).where(eq(leads.organizationId, ORG));
  await db.delete(leads).where(eq(leads.organizationId, OTHER_ORG));
  await db.delete(users).where(eq(users.organizationId, ORG));
  await db.delete(users).where(eq(users.organizationId, OTHER_ORG));
  await db.delete(organizations).where(eq(organizations.id, ORG));
  await db.delete(organizations).where(eq(organizations.id, OTHER_ORG));
}

describe("workflow data layer (tenant-scoped)", () => {
  let defId: string;

  beforeAll(async () => {
    await wipe();
    const pw = await bcrypt.hash("x", 4);
    await db.insert(organizations).values([
      { id: ORG, name: "WF Org", slug: `wf-${Date.now()}` },
      { id: OTHER_ORG, name: "WF Other", slug: `wf-other-${Date.now()}` },
    ]);
    await db.insert(users).values([
      { id: "u1", organizationId: ORG, name: "User 1", email: "u1@example.com", passwordHash: pw, role: "BUSINESS_ADMIN" },
      { id: "u2", organizationId: OTHER_ORG, name: "User 2", email: "u2@example.com", passwordHash: pw, role: "BUSINESS_ADMIN" },
    ]);
    await db.insert(leads).values([
      { id: "l1", organizationId: ORG, source: "MANUAL", name: "Lead 1", score: 50, temperature: "WARM", status: "NEW" },
    ]);

    const def = await createWorkflowDefinition(ORG, {
      name: "Follow-up on inactive leads",
      description: "Auto-create task when lead goes quiet",
      triggersJson: JSON.stringify(["lead_inactive"]),
      conditionsJson: JSON.stringify({}),
      actionsJson: JSON.stringify(["create_task"]),
    });
    defId = def.id;
  });

  afterAll(wipe);

  it("creates and lists workflow definitions for the organization", async () => {
    const list = await listWorkflowDefinitions(ORG);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((d) => d.id === defId)).toBe(true);
    expect(list.every((d) => d.organizationId === ORG)).toBe(true);
  });

  it("gets a single workflow definition", async () => {
    const def = await getWorkflowDefinition(ORG, defId);
    expect(def).not.toBeNull();
    expect(def!.name).toBe("Follow-up on inactive leads");
    expect(def!.organizationId).toBe(ORG);
  });

  it("returns null for a workflow in another organization (tenant isolation)", async () => {
    const def = await getWorkflowDefinition(OTHER_ORG, defId);
    expect(def).toBeNull();
  });

  it("returns null for a missing workflow", async () => {
    const def = await getWorkflowDefinition(ORG, "does-not-exist");
    expect(def).toBeNull();
  });

  it("updates a workflow definition", async () => {
    const updated = await updateWorkflowDefinition(ORG, defId, {
      name: "Renamed workflow",
      isEnabled: false,
    });
    expect(updated.name).toBe("Renamed workflow");
    expect(updated.isEnabled).toBe(false);

    const def = await getWorkflowDefinition(ORG, defId);
    expect(def!.name).toBe("Renamed workflow");
    expect(def!.isEnabled).toBe(false);
  });

  it("records and lists workflow executions", async () => {
    const exec = await recordWorkflowExecution({
      organizationId: ORG,
      workflowDefinitionId: defId,
      leadId: "l1",
      status: "COMPLETED",
      triggeredBy: "lead_inactive",
      resultSummary: "Task created for lead l1",
    });
    expect(exec.status).toBe("COMPLETED");
    expect(exec.leadId).toBe("l1");

    const list = await listWorkflowExecutions(ORG);
    expect(list.some((e) => e.id === exec.id)).toBe(true);
    expect(list.every((e) => e.organizationId === ORG)).toBe(true);
  });

  it("does not return executions from another organization", async () => {
    await recordWorkflowExecution({
      organizationId: OTHER_ORG,
      workflowDefinitionId: defId,
      status: "COMPLETED",
      triggeredBy: "test",
    });
    const list = await listWorkflowExecutions(ORG);
    expect(list.every((e) => e.organizationId === ORG)).toBe(true);
    expect(list.some((e) => e.organizationId === OTHER_ORG)).toBe(false);
  });

  it("deletes a workflow definition", async () => {
    await deleteWorkflowDefinition(ORG, defId);
    const def = await getWorkflowDefinition(ORG, defId);
    expect(def).toBeNull();
    const list = await listWorkflowDefinitions(ORG);
    expect(list.some((d) => d.id === defId)).toBe(false);
  });
});
