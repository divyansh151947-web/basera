-- Knowledge System Migration (PostgreSQL with pgvector)
-- Document chunks with embeddings for semantic retrieval
--
-- ID CONVENTION: every Basera table uses TEXT primary keys (app-generated,
-- e.g. `kdoc_<uuid>` / `kch_<uuid>`). knowledge_chunks follows the same
-- convention so inserts from src/lib/knowledge/indexing.ts and foreign keys
-- to the TEXT primary keys of knowledge_documents / organizations match.
-- Timestamps stay TEXT ISO-8601 (same default expression as 0000) so string
-- shape and lexicographic comparison are identical across databases.

-- Enable pgvector extension (requires PostgreSQL 15+ with pgvector
-- installed and a role allowed to CREATE EXTENSION; see docs/POSTGRESQL.md)
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE knowledge_chunks (
	id text PRIMARY KEY NOT NULL,
	document_id text NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
	organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
	chunk_index integer NOT NULL,
	content text NOT NULL,
	embedding vector(1536) NOT NULL, -- OpenAI text-embedding-3-small dimensions
	metadata jsonb, -- { page, section, heading, source_type, etc }
	created_at text DEFAULT to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE INDEX kchunk_org_idx ON knowledge_chunks (organization_id);
--> statement-breakpoint
CREATE INDEX kchunk_doc_idx ON knowledge_chunks (document_id);
--> statement-breakpoint
CREATE INDEX kchunk_created_idx ON knowledge_chunks (created_at);
--> statement-breakpoint
-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX kchunk_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
-- Enhanced knowledge_documents with metadata for chunking and processing
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_file_name text;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_file_type text; -- PDF, DOCX, TXT, MD, CSV, JSON
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_file_size integer;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS project_id text REFERENCES properties(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS property_id text REFERENCES properties(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS locality text;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS city text;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS language text DEFAULT 'en';
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS effective_date text;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS version text;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'pending'; -- pending, processing, completed, failed
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS indexing_status text DEFAULT 'pending'; -- pending, indexing, completed, failed
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS chunk_count integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS error_message text;
--> statement-breakpoint
CREATE INDEX kdoc_project_idx ON knowledge_documents (project_id);
--> statement-breakpoint
CREATE INDEX kdoc_property_idx ON knowledge_documents (property_id);
--> statement-breakpoint
CREATE INDEX kdoc_locality_idx ON knowledge_documents (locality);
--> statement-breakpoint
CREATE INDEX kdoc_city_idx ON knowledge_documents (city);
--> statement-breakpoint
CREATE INDEX kdoc_status_idx ON knowledge_documents (processing_status, indexing_status);
