-- Knowledge System Migration (SQLite)
-- Document chunks with embeddings for semantic retrieval

CREATE TABLE `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`embedding` text NOT NULL, -- JSON array of floats
	`metadata` text, -- JSON: { page, section, heading, source_type }
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kchunk_org_idx` ON `knowledge_chunks` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `kchunk_doc_idx` ON `knowledge_chunks` (`document_id`);
--> statement-breakpoint
CREATE INDEX `kchunk_created_idx` ON `knowledge_chunks` (`created_at`);
--> statement-breakpoint
-- Enhanced knowledge_documents with metadata for chunking and processing
-- Add columns to existing knowledge_documents table
ALTER TABLE `knowledge_documents` ADD COLUMN `source_file_name` text;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `source_file_type` text; -- PDF, DOCX, TXT, MD, CSV, JSON
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `source_file_size` integer;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `project_id` text;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `property_id` text;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `locality` text;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `city` text;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `language` text DEFAULT 'en';
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `effective_date` text;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `version` text;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `tags` text; -- JSON array
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `processing_status` text DEFAULT 'pending'; -- pending, processing, completed, failed
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `indexing_status` text DEFAULT 'pending'; -- pending, indexing, completed, failed
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `chunk_count` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD COLUMN `error_message` text;
--> statement-breakpoint
CREATE INDEX `kdoc_project_idx` ON `knowledge_documents` (`project_id`);
--> statement-breakpoint
CREATE INDEX `kdoc_property_idx` ON `knowledge_documents` (`property_id`);
--> statement-breakpoint
CREATE INDEX `kdoc_locality_idx` ON `knowledge_documents` (`locality`);
--> statement-breakpoint
CREATE INDEX `kdoc_city_idx` ON `knowledge_documents` (`city`);
--> statement-breakpoint
CREATE INDEX `kdoc_status_idx` ON `knowledge_documents` (`processing_status`, `indexing_status`);