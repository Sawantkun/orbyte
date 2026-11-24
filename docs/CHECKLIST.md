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
- [ ] Email verification & password reset (needs an email provider — decide in M6)

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
- [ ] Execution status overlay on nodes — needs execution data (Milestone 3)

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
- [ ] Per-user provider keys (Milestone 5) — the engine currently uses the server's `OPENAI_API_KEY`

## Milestone 4 — Asset manager
- [ ] Storage adapter (local + S3-compatible), signed downloads
- [ ] Upload API (size + MIME validation), thumbnails
- [ ] Library: grid/list, filters, sort, search, favorites, bulk select/delete/tag
- [ ] Asset detail + metadata edit; collections CRUD with cover; tags
- [ ] Automatic workflow output → asset pipeline
- [ ] Tests: upload validation, ownership, metadata, collections, download authz

## Milestone 5 — Integrations & analytics
- [ ] Encrypted provider keys (AES-256-GCM), validate/replace/delete
- [ ] Usage records, estimated spend, usage page, analytics
- [ ] Activity feed coverage for all domain events

## Milestone 6 — Production readiness
- [ ] Redis-backed rate limiting for API + auth
- [ ] CSP, audit of error surfaces, resource limits
- [ ] Performance pass, accessibility pass, responsive polish
- [ ] Dockerfile(s), deployment docs, CI pipeline
