CREATE TABLE `voice_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`conversation_channel` text NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`provider_id` text NOT NULL,
	`is_mock` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`turns` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `voice_org_idx` ON `voice_sessions` (`organization_id`,`status`);