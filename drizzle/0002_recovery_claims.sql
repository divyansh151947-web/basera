CREATE TABLE `recovery_claims` (
	`claim_key` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`leak_type` text,
	`action_type` text,
	`claimed_by` text NOT NULL,
	`claimed_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text DEFAULT 'CLAIMED' NOT NULL,
	`result_summary` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rclaim_org_idx` ON `recovery_claims` (`organization_id`,`status`,`expires_at`);