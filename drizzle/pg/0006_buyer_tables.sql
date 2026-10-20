-- Buyer workspace tables migration (saved, comparisons, visits, recently viewed)
CREATE TABLE "buyer_saved_properties" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"property_id" text NOT NULL,
	"saved_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action,
	FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "bsp_user_idx" ON "buyer_saved_properties" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bsp_property_idx" ON "buyer_saved_properties" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bsp_user_property_idx" ON "buyer_saved_properties" USING btree ("user_id","property_id");--> statement-breakpoint
CREATE TABLE "buyer_property_comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"property_ids" text NOT NULL,
	"created_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	"updated_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "bpc_user_idx" ON "buyer_property_comparisons" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE "buyer_visit_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"property_id" text NOT NULL,
	"scheduled_at" text NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"agent_id" text,
	"notes" text,
	"created_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	"updated_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action,
	FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE cascade ON UPDATE no action,
	FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "bvr_user_idx" ON "buyer_visit_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bvr_property_idx" ON "buyer_visit_requests" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "bvr_status_idx" ON "buyer_visit_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bvr_scheduled_idx" ON "buyer_visit_requests" USING btree ("scheduled_at");--> statement-breakpoint
CREATE TABLE "buyer_recently_viewed" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"property_id" text NOT NULL,
	"viewed_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action,
	FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "brv_user_idx" ON "buyer_recently_viewed" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "brv_property_idx" ON "buyer_recently_viewed" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brv_user_property_idx" ON "buyer_recently_viewed" USING btree ("user_id","property_id");
