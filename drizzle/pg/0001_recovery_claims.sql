CREATE TABLE "recovery_claims" (
	"claim_key" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"leak_type" text,
	"action_type" text,
	"claimed_by" text NOT NULL,
	"claimed_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"status" text DEFAULT 'CLAIMED' NOT NULL,
	"result_summary" text,
	"updated_at" text DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "recovery_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recovery_claims_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "rclaim_org_idx" ON "recovery_claims" ("organization_id","status","expires_at");