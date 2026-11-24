# Orbyte

**Create. Connect. Organize.** — an intelligent workspace that connects AI workflows, automates creative processes, and organizes everything AI creates.

> Status: **Milestone 4 (Asset manager)** complete. See [`docs/CHECKLIST.md`](docs/CHECKLIST.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Requirements
- Node.js ≥ 22, pnpm 11
- PostgreSQL 15+ and Redis 7+ (`docker compose up -d` provides both, or use Homebrew services)

## Getting started
```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY
                               # secrets: openssl rand -base64 32
createdb orbyte && createdb orbyte_test
pnpm db:migrate               # apply migrations
pnpm db:seed                  # optional: demo@orbyte.dev / orbyte-demo-password
pnpm dev                      # http://localhost:3000
pnpm worker                   # in a second terminal: runs workflow executions
```

Files are stored under `./.storage` by default; set `STORAGE_PROVIDER="s3"` and the `STORAGE_*` variables for S3, Cloudflare R2 or MinIO.

Running AI nodes needs `OPENAI_API_KEY` in `.env`. Without it, AI nodes fail with a clear "OpenAI isn't configured" error; everything else (inputs, conditions, transforms, HTTP, outputs) runs.

## Scripts
| Command | What it does |
|---|---|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm worker` / `worker:start` | Execution worker (watch mode / production) |
| `pnpm typecheck` | Generate route types + `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit + integration (uses the `*_test` database) |
| `pnpm test:e2e` | Playwright against a production build on port 3100 (`*_test` DB) |
| `pnpm check` | typecheck + lint + test + build |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:studio` | Prisma workflows |

Tests use `TEST_DATABASE_URL`, or `DATABASE_URL` with the database name suffixed `_test`. They refuse to run against any other database.
