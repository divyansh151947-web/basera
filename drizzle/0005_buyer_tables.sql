-- Buyer tables migration
CREATE TABLE `buyer_property_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text,
	`property_ids` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bpc_user_idx` ON `buyer_property_comparisons` (`user_id`);
--> statement-breakpoint
CREATE TABLE `buyer_recently_viewed` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`property_id` text NOT NULL,
	`viewed_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `brv_user_idx` ON `buyer_recently_viewed` (`user_id`);
--> statement-breakpoint
CREATE INDEX `brv_property_idx` ON `buyer_recently_viewed` (`property_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `brv_user_property_idx` ON `buyer_recently_viewed` (`user_id`,`property_id`);
--> statement-breakpoint
CREATE TABLE `buyer_saved_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`property_id` text NOT NULL,
	`saved_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bsp_user_idx` ON `buyer_saved_properties` (`user_id`);
--> statement-breakpoint
CREATE INDEX `bsp_property_idx` ON `buyer_saved_properties` (`property_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `bsp_user_property_idx` ON `buyer_saved_properties` (`user_id`,`property_id`);
--> statement-breakpoint
CREATE TABLE `buyer_visit_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`property_id` text NOT NULL,
	`scheduled_at` text NOT NULL,
	`status` text DEFAULT 'REQUESTED' NOT NULL,
	`agent_id` text,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`property_id`) REFERENCES `properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bvr_user_idx` ON `buyer_visit_requests` (`user_id`);
--> statement-breakpoint
CREATE INDEX `bvr_property_idx` ON `buyer_visit_requests` (`property_id`);
--> statement-breakpoint
CREATE INDEX `bvr_status_idx` ON `buyer_visit_requests` (`status`);
--> statement-breakpoint
CREATE INDEX `bvr_scheduled_idx` ON `buyer_visit_requests` (`scheduled_at`);
--> statement-breakpoint
CREATE TABLE `buyer_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`budget_min_inr` integer,
	`budget_max_inr` integer,
	`preferred_city` text,
	`preferred_locality` text,
	`property_type` text,
	`bhk` integer,
	`min_area_sqft` integer,
	`max_area_sqft` integer,
	`furnishing` text,
	`possession_timeline` text,
	`purpose` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bp_user_idx` ON `buyer_preferences` (`user_id`);