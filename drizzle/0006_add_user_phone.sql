-- Buyer profile support: optional phone number on users.
-- Additive and nullable: safe on existing databases, no backfill needed.
ALTER TABLE `users` ADD `phone` text;
