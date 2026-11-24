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

## Milestone 2 — Workflow Studio
- [ ] Workflow definition schema (Zod, versioned) + graph validator (cycles, reachability, ports, template vars)
- [ ] Workflow CRUD API + list page (search, pagination) + duplicate/delete
- [ ] React Flow editor: drag-drop palette, connections, minimap, controls, selection, delete, duplicate
- [ ] Node components + config panels: Input, AI Text, AI Image, Prompt Template, Condition, Transform, HTTP Request, Output
- [ ] Undo/redo, autosave draft, publish → WorkflowVersion, version history
- [ ] Prompt template library (new `PromptTemplate` model)
- [ ] Tests: validator unit tests, API authz, E2E create/save/reopen

## Milestone 3 — Execution engine
- [ ] Worker process (`worker/`), BullMQ queue, graceful shutdown
- [ ] Scheduler: topo order, bounded concurrency, branch skipping
- [ ] Node handlers; OpenAI text provider via provider registry; pricing config
- [ ] Retries, timeouts, cancellation, idempotency
- [ ] SSRF-safe HTTP client; log redaction
- [ ] Executions list/detail UI with per-node inspection; cancel/retry API
- [ ] Tests: dependency resolution, branches, failures, retries, cancellation, SSRF

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
