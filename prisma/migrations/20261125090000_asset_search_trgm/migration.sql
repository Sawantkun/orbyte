-- Trigram indexes for case-insensitive substring search (ILIKE '%q%') in the
-- asset library. Semantic search (pgvector) is a later, separate addition.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "asset_name_trgm_idx" ON "asset" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "asset_description_trgm_idx" ON "asset" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "asset_original_prompt_trgm_idx" ON "asset" USING GIN ("originalPrompt" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "asset_tag_name_trgm_idx" ON "asset_tag" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "workflow_name_trgm_idx" ON "workflow" USING GIN ("name" gin_trgm_ops);
