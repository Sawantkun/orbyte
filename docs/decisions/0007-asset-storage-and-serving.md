# ADR-0007: Asset storage, validation and serving

**Status:** accepted (Milestone 4)

**Stream through the app instead of using pre-signed URLs.** Every asset request is authorised by the app and streamed from storage. Pre-signed URLs would offload bandwidth but are bearer tokens that can leak via logs or sharing, and they make headers (CSP, nosniff) depend on the bucket's configuration. A CDN or pre-signed-URL fast path for thumbnails can be added later behind the same route.

**Allowlist + sniffing, canonical MIME types.** The browser-declared type is ignored. A file is accepted only if its extension is allowlisted and its bytes agree. Code, HTML and other text are stored and served as `text/plain`, so user content is never interpreted by the browser.

**Sandboxed responses.** All user content is served with `X-Content-Type-Options: nosniff` and a CSP containing `sandbox`, so even an SVG opened directly cannot run script. PDF is the one exception, because the browser PDF viewer refuses to run sandboxed; it gets `default-src 'none'` with framing limited to the app. As a result the global `X-Frame-Options` is `SAMEORIGIN` rather than `DENY`.

**Generated images are always assets.** Image bytes cannot live in Postgres and need a durable home, so the AI Image node always stores them in the library (with prompt, model and run provenance). The node's "save to library" flag is kept for schema compatibility. Output nodes decide whether text or JSON results become files.

**Trigram search now, embeddings later.** `pg_trgm` GIN indexes make `ILIKE '%q%'` fast enough for the MVP and are declared in the Prisma schema so migrations stay drift-free. Semantic search remains a separate, explicit feature (ADR-0003).
