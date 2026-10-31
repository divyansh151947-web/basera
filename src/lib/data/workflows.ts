import "server-only";
import { db } from "@/db/client";
import {
  workflowDefinitions,
  workflowExecutions,
  leads,
} from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

export type WorkflowDefinition = Awaited<
  ReturnType<typeof listWorkflowDefinitions>
>[number];

export interface CreateWorkflowDefinitionInput {
  name: string;
  description?: string | null;
  triggersJson: string;
  conditionsJson: string;
  actionsJson: string;
}

export interface UpdateWorkflowDefinitionInput {
  name?: string;
  description?: string | null;
  isEnabled?: boolean;
  triggersJson?: string;
  conditionsJson?: string;
  actionsJson?: string;
}

/** List workflow definitions for an organization. */
export async function listWorkflowDefinitions(organizationId: string) {
  return db
    .select()
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.organizationId, organizationId))
    .orderBy(desc(workflowDefinitions.createdAt));
}

/** Get one workflow definition, org-scoped. */
export async function getWorkflowDefinition(
  organizationId: string,
  id: string
) {
  const rows = await db
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.id, id),
        eq(workflowDefinitions.organizationId, organizationId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Create a workflow definition. */
export async function createWorkflowDefinition(
  organizationId: string,
  data: CreateWorkflowDefinitionInput
) {
  const [row] = await db
    .insert(workflowDefinitions)
    .values({
      organizationId,
      name: data.name,
      description: data.description ?? null,
      isEnabled: true,
      triggersJson: data.triggersJson,
      conditionsJson: data.conditionsJson,
      actionsJson: data.actionsJson,
    })
    .returning();
  return row;
}

/** Update a workflow definition (org-scoped). */
export async function updateWorkflowDefinition(
  organizationId: string,
  id: string,
  data: UpdateWorkflowDefinitionInput
) {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v !== undefined) sanitized[k] = v;
  }
  sanitized.updatedAt = new Date().toISOString();

  const [row] = await db
    .update(workflowDefinitions)
    .set(sanitized as any)
    .where(
      and(
        eq(workflowDefinitions.id, id),
        eq(workflowDefinitions.organizationId, organizationId)
      )
    )
    .returning();
  return row;
}

/** Delete a workflow definition (org-scoped). Cascades to executions. */
export async function deleteWorkflowDefinition(
  organizationId: string,
  id: string
) {
  await db
    .delete(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.id, id),
        eq(workflowDefinitions.organizationId, organizationId)
      )
    );
}

/** List workflow executions for an organization, newest first. */
export async function listWorkflowExecutions(organizationId: string, limit = 50) {
  return db
    .select({
      id: workflowExecutions.id,
      organizationId: workflowExecutions.organizationId,
      workflowDefinitionId: workflowExecutions.workflowDefinitionId,
      leadId: workflowExecutions.leadId,
      status: workflowExecutions.status,
      triggeredBy: workflowExecutions.triggeredBy,
      resultSummary: workflowExecutions.resultSummary,
      createdAt: workflowExecutions.createdAt,
      updatedAt: workflowExecutions.updatedAt,
      definitionName: workflowDefinitions.name,
    })
    .from(workflowExecutions)
    .leftJoin(
      workflowDefinitions,
      eq(workflowDefinitions.id, workflowExecutions.workflowDefinitionId)
    )
    .where(eq(workflowExecutions.organizationId, organizationId))
    .orderBy(desc(workflowExecutions.createdAt))
    .limit(limit);
}

/** Record a workflow execution. */
export async function recordWorkflowExecution(data: {
  organizationId: string;
  workflowDefinitionId: string;
  leadId?: string | null;
  status: "PENDING" | "COMPLETED" | "FAILED" | "SKIPPED";
  triggeredBy: string;
  resultSummary?: string | null;
}) {
  const [row] = await db
    .insert(workflowExecutions)
    .values({
      organizationId: data.organizationId,
      workflowDefinitionId: data.workflowDefinitionId,
      leadId: data.leadId ?? null,
      status: data.status,
      triggeredBy: data.triggeredBy,
      resultSummary: data.resultSummary ?? null,
    })
    .returning();
  return row;
}

/** Get enabled workflow definitions matching a trigger, for the execution engine. */
export async function getEnabledWorkflowsByTrigger(
  organizationId: string,
  trigger: string
) {
  const all = await listWorkflowDefinitions(organizationId);
  return all.filter((d) => {
    if (!d.isEnabled) return false;
    try {
      const triggers = JSON.parse(d.triggersJson ?? "[]");
      return Array.isArray(triggers) && triggers.includes(trigger);
    } catch {
      return false;
    }
  });
}
