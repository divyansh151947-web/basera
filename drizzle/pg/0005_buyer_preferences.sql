-- Buyer preferences table migration
CREATE TABLE "buyer_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"budget_min_inr" integer,
	"budget_max_inr" integer,
	"preferred_city" text,
	"preferred_locality" text,
	"property_type" text,
	"bhk" integer,
	"min_area_sqft" integer,
	"max_area_sqft" integer,
	"furnishing" text,
	"possession_timeline" text,
	"purpose" text,
	"created_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	"updated_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bp_user_idx" ON "buyer_preferences" ("user_id");