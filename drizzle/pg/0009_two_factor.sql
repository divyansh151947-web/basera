-- Two-factor authentication (TOTP): credentials, expiring login challenges,
-- and hashed recovery codes. Additive only — no existing table is touched.
CREATE TABLE "two_factor_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"secret_enc" text NOT NULL,
	"enabled_at" text,
	"created_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	"updated_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tf_cred_user_idx" ON "two_factor_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE "two_factor_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"verified_at" text,
	"used_at" text,
	"created_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "tf_chal_user_idx" ON "two_factor_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tf_chal_expiry_idx" ON "two_factor_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE TABLE "two_factor_recovery_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" text,
	"created_at" text NOT NULL DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
	FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "tf_rec_user_idx" ON "two_factor_recovery_codes" USING btree ("user_id");
