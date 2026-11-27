# ADR-0003: Traditional search first, pgvector later

**Status:** accepted (Milestone 1)

Milestone 4 ships keyword search over asset name, description, tags, original prompt and workflow name (Postgres `ILIKE`/trigram or `tsvector` — decided then, with indexes).

Semantic search ("purple futuristic dashboard images from last week") needs embeddings. When built, it adds the `vector` extension and an `AssetEmbedding` table populated by the worker, combined with structured filters (owner, kind, date range). It is intentionally **not** in the MVP schema so nothing pretends to be semantic before it is.

## Update (Milestone 7): built without pgvector
The local Postgres used for development doesn't ship the `vector` extension, so the first version stores embeddings in an `AssetEmbedding` table as a `double precision[]` column and ranks candidates in the app (cosine similarity, after owner and structured filters, capped at 5,000 candidates per search). Keyword matches get a small boost so exact names stay on top; without an embeddings provider, search stays keyword-only and the UI says "Keyword search". The worker indexes assets on create and on edits to name, description or tags, skipping unchanged text by hash.

Moving to pgvector later is a column-type migration (`vector(1536)`) plus an HNSW index and an `ORDER BY embedding <=> $query` query; the table and indexing flow stay the same.
