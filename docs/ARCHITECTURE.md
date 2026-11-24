# Orbyte — Architecture

> Create. Connect. Organize.
> Orbyte connects AI workflows, runs them reliably in the background, and turns everything they produce into a searchable, reusable asset library.

This document is the source of truth for how Orbyte is built. Decisions with real trade-offs are recorded in [`docs/decisions/`](./decisions).

---

## 1. System overview

```
                ┌─────────────────────────── Next.js app (web) ───────────────────────────┐
 Browser ──────▶│ proxy.ts (optimistic auth redirect)                                      │
                │ App Router pages (RSC) ── src/server/* (DAL, services) ── Prisma ───────┼──▶ PostgreSQL
                │ Route handlers /api/*  ── Zod validation ── ownership checks             │
                │ Server actions          ── Better Auth (sessions, credentials)           │
                └───────────────┬──────────────────────────────────────────────────────────┘
                                │ enqueue (BullMQ)                          ▲ object storage
                                ▼                                           │ (S3 / local)
                         Redis ──────▶ Worker process (Milestone 3) ────────┘
                                       graph executor · provider adapters · asset writer
```

* **Web app** (Next.js 16 App Router): UI, API, auth, and all *definition* management. It never executes workflow nodes.
* **Worker** (`worker/index.ts`): a separate Node process consuming BullMQ jobs. Executes validated workflow versions, calls AI providers, writes assets. Shares `src/server` and `src/lib` code with the web app but runs independently, so it can be scaled or extracted later.
* **PostgreSQL**: all metadata. **Redis**: queue + (later) rate-limit storage. **Object storage**: all binary content.

Modular monolith, not microservices: one repo, one schema, clear module boundaries that can be split later.

## 2. Directory structure

```
orbyte/
├── docs/                       Architecture, checklist, ADRs
├── prisma/
│   ├── schema.prisma           Data model (all milestones)
│   ├── migrations/             SQL migrations (committed)
│   └── seed.ts                 Development-only demo data
├── src/
│   ├── app/
│   │   ├── (marketing)/        Public landing page  "/"
│   │   ├── (auth)/             /login, /signup
│   │   ├── (app)/              Authenticated shell + every product route
│   │   │   ├── dashboard/  workflows/  executions/  assets/
│   │   │   ├── collections/  integrations/  settings/{profile,security,usage}
│   │   │   └── layout.tsx      requireUser() + AppShell
│   │   └── api/                auth/[...all], health, (later) REST endpoints
│   ├── components/
│   │   ├── ui/                 shadcn/ui primitives (generated, lightly themed)
│   │   ├── brand/              Logo / mark
│   │   ├── layout/             Sidebar, top bar, command palette, page header
│   │   └── <feature>/          Feature components (dashboard, settings, …)
│   ├── config/                 Navigation, feature-availability flags
│   ├── lib/                    Framework-agnostic helpers: env, db, auth, validation, formatting
│   ├── server/                 Server-only services & data access (always owner-scoped)
│   ├── generated/prisma/       Generated Prisma client (git-ignored)
│   └── proxy.ts                Next 16 "proxy" (formerly middleware)
├── worker/                     (Milestone 3) BullMQ worker entry point
└── tests/
    ├── unit/  integration/     Vitest (integration hits a real *_test database)
    └── e2e/                    Playwright against a production build
```

Layering rule: `app/` → `server/` → `lib/`. Components never import Prisma. Everything under `server/` imports `server-only`.

## 3. Key dependencies

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.4 (App Router, Turbopack) | Classic dynamic rendering, see ADR-0002 |
| UI | React 19, Tailwind 4, shadcn/ui (Radix), lucide-react, cmdk, sonner | Dark-first theme tokens in `globals.css` |
| Forms / validation | react-hook-form + Zod 4 | Same schemas validate client and server |
| Auth | Better Auth 1.7 (email + password) | Prisma adapter, DB sessions |
| ORM / DB | Prisma 7.10 + `@prisma/adapter-pg`, PostgreSQL 17 | Prisma 8 is still RC — pinned to 7.x |
| Queue | BullMQ 5 + Redis | Used from Milestone 3 |
| Charts | Recharts 3 | |
| Workflow canvas | @xyflow/react 13 | Milestone 2 |
| Tests | Vitest 5, Playwright 1.65 | |

## 4. Authentication & authorization

* **Better Auth** owns `user`, `session`, `account`, `verification`. Sessions are database-backed with an httpOnly cookie; the cookie cache is **disabled** so revoking a session is immediate.
* **Three layers**:
  1. `src/proxy.ts` — *optimistic* redirect to `/login` when no session cookie exists. Not a security boundary.
  2. `src/server/session.ts` — the Data Access Layer. `requireUser()` validates the session against the DB on every request. Every page, action and route handler calls it.
  3. Service functions take `ownerId` explicitly and **always** filter by it (`where: { id, ownerId }`). Lookups of another user's id behave exactly like "not found" (no existence oracle).
* Post-login redirects go through `safeRedirectPath()` to prevent open redirects.
* Auth endpoints are rate-limited by Better Auth (sign-in 10/min, sign-up 5/min, change-password 5/min per IP; memory store — moves to Redis in Milestone 6).
* Passwords: 10–128 chars, hashed by Better Auth (scrypt).

## 5. Database design

Full schema: [`prisma/schema.prisma`](../prisma/schema.prisma). Highlights:

* **Ownership everywhere.** Every product table has `ownerId → user.id ON DELETE CASCADE` and a composite index leading with `ownerId` (usually `(ownerId, createdAt DESC)`), which serves both isolation and cursor pagination.
* **Workflows are versioned.** `Workflow.definition` is the editable draft. Publishing snapshots it into an immutable `WorkflowVersion (workflowId, version)`. Executions reference a *version*, so a run is always reproducible and editing never changes history.
* **Executions** (`WorkflowExecution`) and **node runs** (`NodeExecution`, unique on `(executionId, nodeId, attempt)`) carry status enums matching the spec lifecycles, timings, token counts and `Decimal(14,6)` cost. `(ownerId, idempotencyKey)` is unique to suppress duplicate submissions. Errors are stored *sanitised*.
* **Assets** store metadata only; `storageKey` points at object storage and is never sent to clients. Provenance (`workflowId`, `executionId`, `nodeId`, `originalPrompt`, `aiProvider`, `aiModel`) is nullable with `ON DELETE SET NULL`, so **deleting a workflow keeps its assets**.
* **Collections**: an asset belongs to at most one collection (`collectionId SET NULL`), so **deleting a collection never deletes assets**. Tags are per-user (`AssetTag (ownerId, name)` unique) with a join table.
* **Integrations** store AES-256-GCM ciphertext + IV + auth tag + `keyVersion` (for rotation) + a 4-char hint. Plaintext never touches the DB or the client.
* **UsageRecord** has nullable `costUsd`: unknown pricing is `NULL`, not `0`, so the UI can say "no priced usage" instead of inventing "$0.00".
* **ActivityLog** powers the feed and notifications.
* Future semantic search: add `pgvector` and an `AssetEmbedding(assetId, embedding vector, model)` table — kept out of the MVP schema on purpose (ADR-0003).

## 6. Workflows

### 6.1 Definition format (Milestone 2)

```jsonc
{
  "schemaVersion": 1,
  "nodes": [{ "id": "n_x", "type": "ai_text", "position": {"x":0,"y":0},
              "data": { "key": "draft", "label": "Draft", "config": { /* per-type */ } } }],
  "edges": [{ "id": "e_y", "source": "n_a", "target": "n_x", "sourceHandle": "out", "targetHandle": "in" }]
}
```

* `src/lib/workflow/` is **pure, framework-free TypeScript** shared by the editor, the API and the worker.
* Every node has a stable `key` (e.g. `draft`). Templates reference upstream data as `{{key.field}}` (`{{draft.text}}`) or Input fields by name (`{{topic}}`). References must point to an **ancestor** in the graph; the validator enforces this so the executor never sees an unresolved variable.
* Handles: every node except Input accepts `in`; Condition emits `true`/`false`; Output emits nothing.
* **Drafts may be invalid** (structure is validated on save, graph rules are not), so work is never lost. **Publishing requires a valid graph** and snapshots it, plus the derived `inputSchema`, into an immutable `WorkflowVersion`.
* Saves carry `expectedUpdatedAt`; a stale save returns **409** instead of overwriting another tab's edits.
* The provider/model catalogue lives in `src/config/ai-models.ts`, not in node code.

### 6.2 API

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/workflows` | `?q=&status=&cursor=&limit=`; POST `{ name, description?, starter }` |
| GET/PATCH/DELETE | `/api/workflows/:id` | PATCH `{ name?, description?, definition?, expectedUpdatedAt? }` |
| POST | `/api/workflows/:id/duplicate` | Copies the draft (no versions) |
| POST | `/api/workflows/:id/publish` | 422 `{ details.issues }` when invalid |
| GET | `/api/workflows/:id/versions[/:version]` | Version list / snapshot |
| POST | `/api/workflows/:id/versions/:version/restore` | Replaces the draft |
| GET/POST, PATCH/DELETE | `/api/prompt-templates[/:id]` | Per-user prompt library |

Envelope: `{ data, meta? }` or `{ error: { code, message, details? } }`. All handlers use `withUser()` (`src/server/api.ts`), which authenticates from the request, validates with Zod and maps errors. Resources owned by another user return **404**.

### 6.3 Editor

Zustand store per editor instance (`components/studio/store.ts`) holds nodes/edges, selection, undo/redo snapshots (edits to the same field within 1 s coalesce) and a revision counter used by autosave to detect edits made during a save. React Flow (v13) renders it; deletion is routed through the store so it is undoable. Validation runs live on a deferred copy of the graph.

### 6.4 Execution (Milestone 3)

```
Studio "Run" → POST /api/workflows/:id/execute
   ├─ validate inputs against the version's inputSchema (coerce types)
   ├─ tx: WorkflowExecution(PENDING) + NodeExecution(PENDING) per node
   └─ BullMQ add(jobId = executionId)            ──▶  Redis
                                                        │
worker/index.ts (separate process) ◀────────────────────┘
   └─ runExecution(executionId)  src/server/engine/executor.ts
        ├─ load immutable version, re-validate
        ├─ schedule: ready = all predecessors settled
        │    run if ≥1 incoming edge active (source COMPLETED and, for a Condition, the taken handle)
        │    else SKIPPED; nodes without inputs always run; ≤ EXECUTION_NODE_CONCURRENCY at once
        ├─ node: resolve {{refs}} → handler (AbortSignal: timeout + cancellation) → persist
        │    retryable errors (429/5xx/timeouts/network) → new attempt row, backoff or Retry-After
        ├─ failure → fail fast: abort in-flight nodes, remaining nodes SKIPPED
        ├─ cancel → API sets cancelRequestedAt; worker polls it and aborts
        └─ finalize: status, outputs (Output nodes by name), tokens, cost, activity
```

* **Idempotent and resumable.** Finished executions are a no-op. A `RUNNING` execution picked up again (worker crash → BullMQ stalled-job re-delivery) keeps completed node outputs, marks in-flight attempts `FAILED (INTERRUPTED)` and continues.
* **Providers** (`src/server/providers/`) implement `TextProvider`; a `ProviderResolver` supplies a client plus the secrets to redact. The OpenAI adapter calls the Responses API with plain `fetch`. Credentials come from `OPENAI_API_KEY` today; Milestone 5 adds per-user encrypted keys ahead of it.
* **Cost** = catalogue pricing × tokens. Models without pricing record `NULL` cost.
* **HTTP Request node** uses `safe-http.ts`: static URL check, then DNS answers are validated in the socket's `lookup` (the exact address connected to), sockets are never pooled (a reused socket would bypass the check), every redirect is re-checked, 2 MB response cap.
* **Persistence hygiene.** Inputs, outputs, logs and errors pass through `redact()` (known secrets, key-like fields, token patterns). Persisted JSON is capped at 256 KB per value.
* **Image generation** is wired in the editor but returns `NOT_AVAILABLE` at run time until object storage exists (Milestone 4).

## 7. Security model (summary)

| Risk | Mitigation |
|---|---|
| Cross-user data access | Owner-scoped queries in `src/server/*`; integration tests assert isolation |
| Session theft / fixation | httpOnly, SameSite=Lax, `Secure` in production; DB sessions; revocation UI |
| Brute force | Better Auth rate limits on auth endpoints |
| Open redirect | `safeRedirectPath()` |
| Secret leakage | Env validated at boot (names only in errors); provider keys encrypted (AES-256-GCM); log redaction; `storageKey` never serialised |
| SSRF (HTTP node, M3) | https/http only, DNS resolve then block private/loopback/link-local/metadata ranges (incl. IPv6 + mapped), re-check on redirect, size + time limits |
| Arbitrary code | No JS/shell execution in nodes; Transform node uses a fixed set of declarative operations |
| Uploads (M4) | Size limit, MIME sniffing vs. extension allow-list, random storage keys, downloads via short-lived signed URLs or authorised streaming |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `nosniff`, strict referrer policy (next.config) |
| Error leakage | Error boundaries show a digest only; server logs omit secrets |

## 8. Rendering model

Every product page is per-user and reads the session, so Orbyte uses classic dynamic rendering (Cache Components off). See [ADR-0002](./decisions/0002-rendering-model.md).

## 9. Feature flags for unbuilt milestones

`src/config/features.ts` declares which features are available. Entry points for future milestones render disabled with "Coming in Milestone N" instead of linking to non-functional screens; routes exist and show an honest notice. Flip the flag when the milestone ships.
