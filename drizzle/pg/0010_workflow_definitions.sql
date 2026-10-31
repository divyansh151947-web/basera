-- Automated sales workflow definitions and execution history.
-- Additive only — no existing table is touched. Workflow definitions are
-- organization-scoped; executions record what ran, when, and with what result.
CREATE TABLE "workflow_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_enabled" boolean NOT NULL DEFAULT true,
	"triggers_json" text NOT NULL DEFAULT '[]',
	"conditions_json" text NOT NULL DEFAULT '{}',
	"actions_json" text NOT NULL DEFAULT '[]',
	"created_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	"updated_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wfdef_org_name_idx" ON "workflow_definitions" USING btree ("organization_id", "name");--> statement-breakpoint
CREATE INDEX "wfdef_org_enabled_idx" ON "workflow_definitions" USING btree ("organization_id", "is_enabled");--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workflow_definition_id" text NOT NULL,
	"lead_id" text,
	"status" text NOT NULL DEFAULT 'PENDING',
	"triggered_by" text NOT NULL,
	"result_summary" text,
	"created_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	"updated_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE cascade ON UPDATE no action,
	FOREIGN KEY ("workflow_definition_id") REFERENCES "workflow_definitions"("id") ON DELETE cascade ON UPDATE no action,
	FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "wfexec_org_idx" ON "workflow_executions" USING btree ("organization_id", "created_at");--> statement-breakpoint
CREATE INDEX "wfexec_def_idx" ON "workflow_executions" USING btree ("workflow_definition_id");--> statement-breakpoint
CREATE INDEX "wfexec_lead_idx" ON "workflow_executions" USING btree ("lead_id");
