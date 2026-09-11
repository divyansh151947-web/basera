CREATE TABLE `ai_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`tone` text DEFAULT 'friendly_professional' NOT NULL,
	`primary_language` text DEFAULT 'auto' NOT NULL,
	`greeting` text DEFAULT 'Hi! Thanks for your interest. Could you tell me what kind of property you''re looking for?' NOT NULL,
	`qualification_rules_json` text DEFAULT '{}',
	`handoff_rules_json` text DEFAULT '{}',
	`follow_up_rules_json` text DEFAULT '{"intervalsDays":[1,3,7],"maxAttempts":3}',
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aicfg_org_idx` ON `ai_configs` (`organization_id`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`property_id` text,
	`agent_id` text,
	`type` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`status` text DEFAULT 'SCHEDULED' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appt_org_idx` ON `appointments` (`organization_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `appt_lead_idx` ON `appointments` (`lead_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`metadata_json` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_org_idx` ON `audit_logs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'AI_HANDLING' NOT NULL,
	`handoff_reason` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conv_org_idx` ON `conversations` (`organization_id`);--> statement-breakpoint
CREATE INDEX `conv_lead_idx` ON `conversations` (`lead_id`);--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`scheduled_for` text NOT NULL,
	`channel` text NOT NULL,
	`message_draft` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`sent_at` text,
	`stop_reason` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fu_org_status_idx` ON `follow_ups` (`organization_id`,`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `fu_lead_idx` ON `follow_ups` (`lead_id`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`config_json` text DEFAULT '{}',
	`status` text DEFAULT 'NOT_CONNECTED' NOT NULL,
	`last_sync_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `integ_org_idx` ON `integrations` (`organization_id`);--> statement-breakpoint
CREATE TABLE `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kdoc_org_idx` ON `knowledge_documents` (`organization_id`);--> statement-breakpoint
CREATE TABLE `lead_property_interests` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`property_id` text NOT NULL,
	`match_type` text NOT NULL,
	`match_score` integer NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lpi_lead_idx` ON `lead_property_interests` (`lead_id`);--> statement-breakpoint
CREATE INDEX `lpi_prop_idx` ON `lead_property_interests` (`property_id`);--> statement-breakpoint
CREATE TABLE `lead_score_events` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`score` integer NOT NULL,
	`temperature` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lse_lead_idx` ON `lead_score_events` (`lead_id`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text,
	`phone` text,
	`email` text,
	`source` text NOT NULL,
	`preferred_city` text,
	`preferred_locality` text,
	`property_type` text,
	`bhk` integer,
	`budget_min_inr` integer,
	`budget_max_inr` integer,
	`purpose` text,
	`timeline` text,
	`loan_required` integer,
	`site_visit_interest` integer,
	`decision_maker` integer,
	`status` text DEFAULT 'NEW' NOT NULL,
	`temperature` text DEFAULT 'COLD' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`ai_summary` text,
	`assigned_agent_id` text,
	`tags_json` text DEFAULT '[]',
	`last_contact_at` text,
	`next_follow_up_at` text,
	`opted_out` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_agent_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lead_org_idx` ON `leads` (`organization_id`);--> statement-breakpoint
CREATE INDEX `lead_status_idx` ON `leads` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `lead_temp_idx` ON `leads` (`organization_id`,`temperature`);--> statement-breakpoint
CREATE INDEX `lead_phone_idx` ON `leads` (`organization_id`,`phone`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sender` text NOT NULL,
	`sender_user_id` text,
	`content` text NOT NULL,
	`language` text,
	`metadata_json` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `msg_conv_idx` ON `messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`author_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `note_lead_idx` ON `notes` (`lead_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notif_org_idx` ON `notifications` (`organization_id`,`is_read`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo_url` text,
	`phone` text,
	`email` text,
	`locations_json` text DEFAULT '[]',
	`is_demo` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_slug_idx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tier` text NOT NULL,
	`monthly_price_inr` integer NOT NULL,
	`lead_limit` integer NOT NULL,
	`ai_message_limit` integer NOT NULL,
	`team_member_limit` integer NOT NULL,
	`property_limit` integer NOT NULL,
	`features` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`project_name` text NOT NULL,
	`developer` text,
	`property_type` text NOT NULL,
	`bhk` integer,
	`city` text NOT NULL,
	`locality` text NOT NULL,
	`address` text,
	`price_min_inr` integer NOT NULL,
	`price_max_inr` integer NOT NULL,
	`area_sqft` integer,
	`floor` text,
	`amenities_json` text DEFAULT '[]',
	`parking` integer DEFAULT false NOT NULL,
	`possession_date` text,
	`availability` text DEFAULT 'AVAILABLE' NOT NULL,
	`furnishing` text,
	`description` text,
	`images_json` text DEFAULT '[]',
	`brochure_url` text,
	`documents_json` text DEFAULT '[]',
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prop_org_idx` ON `properties` (`organization_id`);--> statement-breakpoint
CREATE INDEX `prop_match_idx` ON `properties` (`organization_id`,`city`,`bhk`,`property_type`);--> statement-breakpoint
CREATE TABLE `property_units` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`unit_number` text NOT NULL,
	`floor` text,
	`area_sqft` integer,
	`price_inr` integer,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `unit_prop_idx` ON `property_units` (`property_id`);--> statement-breakpoint
CREATE TABLE `scoring_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`weights_json` text NOT NULL,
	`hot_threshold` integer DEFAULT 80 NOT NULL,
	`warm_threshold` integer DEFAULT 50 NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_org_idx` ON `scoring_configs` (`organization_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'TRIALING' NOT NULL,
	`trial_ends_at` text,
	`current_period_end` text,
	`provider_ref` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sub_org_idx` ON `subscriptions` (`organization_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`lead_id` text,
	`assignee_id` text NOT NULL,
	`title` text NOT NULL,
	`due_at` text,
	`is_done` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_org_idx` ON `tasks` (`organization_id`);--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`ai_messages` integer DEFAULT 0 NOT NULL,
	`leads_created` integer DEFAULT 0 NOT NULL,
	`follow_ups_sent` integer DEFAULT 0 NOT NULL,
	`active_users` integer DEFAULT 0 NOT NULL,
	`storage_mb` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_org_idx` ON `usage_records` (`organization_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`email_verified_at` text,
	`last_login_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `user_org_idx` ON `users` (`organization_id`);