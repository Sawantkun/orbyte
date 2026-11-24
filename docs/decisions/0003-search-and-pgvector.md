# ADR-0003: Traditional search first, pgvector later

**Status:** accepted (Milestone 1)

Milestone 4 ships keyword search over asset name, description, tags, original prompt and workflow name (Postgres `ILIKE`/trigram or `tsvector` — decided then, with indexes).

Semantic search ("purple futuristic dashboard images from last week") needs embeddings. When built, it adds the `vector` extension and an `AssetEmbedding` table populated by the worker, combined with structured filters (owner, kind, date range). It is intentionally **not** in the MVP schema so nothing pretends to be semantic before it is.
