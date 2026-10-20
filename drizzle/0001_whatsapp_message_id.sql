ALTER TABLE `messages` ADD `external_message_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `msg_external_id_idx` ON `messages` (`external_message_id`);
