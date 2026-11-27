# Orbyte — Implementation checklist

Legend: `[x]` done and tested · `[ ]` not started · `[~]` partial (see note)

## Milestone 1 — Foundation ✅
- [x] Project setup (Next 16, TS strict, Tailwind 4, shadcn/ui, pnpm)
- [x] Environment validation (`src/lib/env.ts`) and `.env.example`
- [x] Design tokens (Orbyte palette, dark-first) and typography (Geist)
- [x] Brand: mark, wordmark, favicon/app icon (`src/app/icon.svg`, `public/orbyte-*.svg`)
- [x] Prisma schema for all milestones + initial migration
- [x] Better Auth: email/password sign-up, sign-in, sign-out, rate limits
- [x] Data Access Layer (`requireUser`) + optimistic `proxy.ts`
- [x] App shell: collapsible sidebar (persisted), mobile sheet nav, top bar, ⌘K command palette, user menu, activity notifications
- [x] Dashboard: greeting, primary actions, 5 metric cards, execution activity chart, asset distribution, recent workflows/executions/assets, quick actions, activity feed — all real data with empty states
- [x] Settings: profile (name), security (change password, list/revoke sessions); usage = milestone notice
- [x] Honest milestone notices for unbuilt routes; disabled entry points via `config/features.ts`
- [x] Loading skeleton, error boundary, global error, 404
- [x] Security headers, safe redirects, health endpoint
- [x] Tests: unit, DB integration (auth, authorization, isolation, cascades), Playwright E2E
- [x] Dev seed (`pnpm db:seed`), docker-compose for Postgres/Redis
- [x] Email verification & password reset (Milestone 7)

## Milestone 2 — Workflow Studio ✅
- [x] Workflow definition schema v1 (Zod), per-node config schemas, size limits (`src/lib/workflow/schema.ts`)
- [x] Node registry: 8 node types with handles, output fields, defaults (`registry.ts`)
- [x] Graph validator: cycles, handles, dangling/self/duplicate edges, keys, config, required fields, model catalogue, upstream-only `{{references}}`, static SSRF URL check (`validate.ts`, `url-safety.ts`)
- [x] Workflow API: list (search + cursor pagination), get, create (starters), update (optimistic concurrency → 409), delete, duplicate, publish → immutable version (422 with issues when invalid), list/get versions, restore
- [x] Prompt template library (`PromptTemplate` model + API), load/save from the Prompt Template node
- [x] Studio: palette (drag or click), canvas (zoom/pan/minimap/controls/snap), custom nodes with issue badges, connection rules (no cycles, no self-loops), inspector with typed forms and variable insertion
- [x] Undo/redo with edit coalescing, duplicate (with internal edges), delete, keyboard shortcuts (⌘Z/⇧⌘Z/⌘Y/⌘D/⌫/⌘S/Esc)
- [x] Autosave (1.5 s idle) + explicit save, unsaved-changes guard, conflict detection across tabs
- [x] Live validation panel; publish/versions/restore UI; responsive panels (sheets below `lg`)
- [x] Workflow list page (search, load more, duplicate, delete with confirm), create page with starters
- [x] Tests: validator, URL safety, templates, editor store, API authz/validation/concurrency/versioning, E2E Studio flows
- [x] Execution status overlay on nodes (run page, and the Studio's "Last run" overlay — Milestone 7)

## Milestone 3 — Execution engine ✅
- [x] Worker process (`worker/index.ts`): BullMQ 6 + Redis, configurable concurrency, graceful shutdown, stalled-job re-delivery, optional `/health`
- [x] Queue isolation by name (`EXECUTION_QUEUE_NAME`); jobId = executionId dedupes submissions
- [x] Executor: re-validation, dependency scheduling, bounded parallelism, condition branches + joins, fail-fast, per-node timeouts, retries with backoff / Retry-After, cancellation (aborts in-flight calls), crash resume from persisted node state
- [x] Node handlers: input, prompt template, AI text, condition, transform, HTTP request, output (AI image returns a clear "not available until M4" error)
- [x] Provider abstraction + OpenAI Responses API adapter (no SDK), error mapping (auth / quota / rate limit / 5xx / rejected)
- [x] Model catalogue refreshed to current OpenAI models with pricing from the official page (2026-11-25); unknown pricing → `NULL`, never $0
- [x] SSRF-safe HTTP client: connect-time DNS validation, no socket pooling, re-checked redirects, size cap, timeouts, header filtering
- [x] Secret redaction for node inputs/outputs/logs/errors; bounded persisted JSON
- [x] Usage records + token and estimated-cost totals per node and per execution
- [x] API: execute (input validation against version schema, idempotency keys), list/filter, detail, cancel, retry; 503 when the queue is down
- [x] UI: Run dialog (typed inputs), executions list (status filters, live refresh), execution detail (live graph with node status, per-node attempts/input/output/logs, cancel/retry)
- [x] Tests: engine semantics, SSRF client, OpenAI adapter, executions API, real Redis round-trip, E2E through a real worker and a mock OpenAI server
- [x] Per-user provider keys (done in Milestone 5)

## Milestone 4 — Asset manager ✅
- [x] Storage abstraction: local adapter (dev) + S3-compatible adapter (AWS S3, R2, MinIO); unguessable owner-scoped keys; path-traversal-proof
- [x] Upload API: size limit (checked before buffering), extension allowlist + magic-byte sniffing (`file-type`), canonical MIME types, JSON/SVG/UTF-8 validation
- [x] Thumbnails (sharp, 480px WebP) with pixel and time limits; image dimensions in metadata
- [x] Safe serving: authorised streaming only, `nosniff`, sandbox CSP, text-like types as `text/plain`, attachment downloads, PDF preview
- [x] Library: search (names, descriptions, tags, prompts, workflow names; trigram-indexed), type/source/collection/tag/favorite/date filters, sort, cursor pagination, grid & list views
- [x] Uploads: multi-file, drag-and-drop anywhere, 3 parallel with per-file progress and errors
- [x] Bulk actions: favorite, add/remove tags, move to collection, delete (with confirm) — owner-scoped
- [x] Asset detail: preview (image, video, audio, PDF, text/JSON/code), metadata editing, tags, collection, favorite, download, delete, generation provenance, related assets
- [x] Collections: create/rename/delete (assets kept), covers (explicit or newest image), counts, search, collection pages with remove-from-collection
- [x] Workflow outputs → assets: AI Image node (OpenAI Images API) stores every image with prompt/provider/model/workflow/execution/node; Output node saves text/JSON or files generated upstream, into a chosen collection, with metadata
- [x] Tests: upload validation, storage keys, S3 adapter commands, API authz/headers/filters/bulk/collections, engine → library pipeline, E2E library/collections/generated images
- [x] Video seeking via HTTP Range requests (done in Milestone 6)
- [x] Semantic search (Milestone 7; float arrays now, pgvector later — ADR-0003)

## Milestone 5 — Integrations & analytics ✅
- [x] AES-256-GCM credential sealing with owner/provider-bound AAD, per-row IV/tag, key versions and a rotation script (`pnpm secrets:rotate`)
- [x] Integrations API: connect (format check + zero-cost validation), replace, re-check, remove; secrets never returned
- [x] Engine credential precedence: user key → platform key → clear error; keys rejected at run time are marked INVALID; resolved keys are redacted everywhere
- [x] Integrations page: status, hint, last checked, replace/re-check/remove with confirmation
- [x] Usage analytics (`/settings/usage`): 7/30/90-day totals, cost per day, by model, by workflow; unpriced usage reported separately
- [x] Activity: paginated `/activity` page grouped by day, linked items, more event types (key replaced, collection deleted, assets deleted), "view all" from the bell and dashboard
- [x] Removed milestone gating (all features live)
- [x] Tests: crypto (tamper/AAD/rotation), integrations API + authz, credential precedence, usage aggregation + isolation, E2E keys/usage/activity
- [x] Multiple keys per provider (Milestone 7)

## Milestone 6 — Production readiness ✅
- [x] Redis-backed rate limiting (atomic Lua) for auth endpoints and per-user API buckets, with an in-process fallback; 429 + `Retry-After`
- [x] Client-IP configuration for proxies (`AUTH_IP_HEADERS`, `TRUSTED_PROXIES`)
- [x] Nonce-based Content-Security-Policy on every page; HSTS and `upgrade-insecure-requests` on https
- [x] Origin check on mutating API requests (CSRF defence in depth)
- [x] Streaming multipart uploads (busboy → temp file, size enforced mid-stream); storage `putFile`
- [x] HTTP Range requests (206/416) for video/audio seeking
- [x] Loading skeletons for every route; hydration-safe timestamps (`<Time>`)
- [x] Accessibility: axe on all pages in E2E; fixed contrast, accessible names, colour-only links
- [x] Standalone build + multi-target Dockerfile (app, worker, migrate), production compose file, health checks
- [x] Fixed standalone tracing for `file-type` (found by running the standalone server)
- [x] GitHub Actions CI: typecheck, lint, drift check, unit/integration, build, E2E; Docker build + smoke test
- [x] Security audit (route auth, server actions, dangerous sinks, logging); `docs/SECURITY.md`, `docs/DEPLOYMENT.md`
- [x] Email verification, password reset and two-factor sign-in (Milestone 7)
- [x] Semantic search (Milestone 7)

## Milestone 7 — Claude, images, email and account security ✅
- [x] Claude (local CLI) provider: owner-only switch in Integrations, isolated CLI (no tools/settings/MCP, empty cwd, allow-listed env), stream-json I/O, error mapping, cancel kills the process
- [x] Image input type; Run dialog upload or pick from the library; AI Text "Image" field (OpenAI and Claude), owner-checked and downscaled
- [x] Send Email node via Gmail (app password, encrypted): preview mode by default, plain text or HTML (+ text fallback), attachments, recipient/size limits, header-injection guard
- [x] Integrations redesign: only added services shown; "Add service" catalogue (AI, email, messaging, storage, docs & data, developer) with search, filters and honest "coming soon" / "built in" badges
- [x] Multiple credentials per provider: names, one default (enforced by a partial unique index), switch default, rename, promote on delete
- [x] Studio "Last run" overlay: latest run's per-node status on the canvas, live while running
- [x] Email verification and password reset (Better Auth), system mail via Gmail or dev console; forgot/reset pages; verify banner
- [x] Two-factor sign-in (TOTP + backup codes, trusted devices): setup with QR, challenge page, disable/regenerate with password
- [x] Semantic asset search: embeddings indexed by the worker, cosine ranking with keyword boost and structured filters, keyword fallback, `pnpm assets:reindex`
- [x] Fixed: keyboard shortcuts crashed on autofill's synthetic keydown events
- [x] Tests: CLI provider (fake executable), image → Claude → email engine path, Gmail integration, multiple keys, account emails, two-factor with real TOTP codes, semantic search; E2E catalogue, local Claude and image runs

### Not built (catalogue "coming soon")
- [ ] Anthropic API, Gemini, Mistral, Ollama; Outlook, SMTP, Resend; Slack, Discord, Telegram, Twilio; Google Drive, Dropbox, S3; Notion, Google Sheets, Airtable; GitHub
