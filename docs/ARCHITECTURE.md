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
* **Worker** (Milestone 3): a separate Node process consuming BullMQ jobs. Executes validated workflow versions, calls AI providers, writes assets. Shares `src/server` and `src/lib` code with the web app but runs independently, so it can be scaled or extracted later.
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

## 6. Workflow execution (Milestones 2–3)

1. **Definition** (`schemaVersion`, `nodes[]`, `edges[]`, `inputSchema`) is validated by a Zod discriminated union per node type, then by graph rules: one+ input node, all edges reference existing nodes/ports, no cycles (Kahn's algorithm), every non-input node reachable, template variables (`{{node.field}}`) resolve to upstream outputs.
2. **Submit**: `POST /api/workflows/:id/execute` validates inputs against `inputSchema`, creates `WorkflowExecution(PENDING)` + `NodeExecution(PENDING)` rows in one transaction, and enqueues `{ executionId }` with `jobId = executionId` (BullMQ dedupes).
3. **Worker**: loads the immutable version, topologically sorts it, and runs ready nodes concurrently up to a per-execution limit (plus a global worker concurrency). Each node: mark RUNNING → resolve inputs → run handler with an `AbortSignal` (timeout + cancellation) → persist output/usage → mark COMPLETED/FAILED.
4. **Branches**: a Condition node marks the untaken branch's exclusive descendants `SKIPPED`.
5. **Retries**: per-node policy (max attempts, exponential backoff, retry only on retryable errors such as 429/5xx/timeouts). Each attempt is its own `NodeExecution` row.
6. **Cancellation**: `cancelRequestedAt` is set by the API; the worker checks it between nodes and aborts in-flight provider calls.
7. **Logs**: structured `{ts, level, message, data}` entries passed through a redactor (API keys, `Authorization` headers, known secret patterns) before persistence.
8. **Outputs → assets**: image/file outputs are streamed to storage, then an `Asset` row is created with full provenance inside the node's completion transaction.

Node handlers implement one interface and live in a registry; providers implement `TextProvider` / `ImageProvider` behind a provider registry with pricing in configuration, not code.

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
