# Orbyte

**Create. Connect. Organize.** — an intelligent workspace that connects AI workflows, automates creative processes, and organizes everything AI creates.

> Status: all six milestones complete. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) to run it in production and [`docs/SECURITY.md`](docs/SECURITY.md) for the security model. See [`docs/CHECKLIST.md`](docs/CHECKLIST.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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

**No OpenAI key? Use your Claude Code subscription (personal use only).** If Claude Code is installed and signed in on this machine, go to **Integrations → Add service → Claude (local CLI)** and turn it on, then pick that provider in an AI Text node. Only the account that turns it on can use it. Runs go through your own `claude` CLI with no tools, settings or MCP servers, and can include an image (AI Text's **Image** field, e.g. `{{photo}}` from an Image input). Set `LOCAL_CLAUDE_CLI="off"` on any deployment other people use; Anthropic doesn't allow offering Claude subscription logins to other users.

**Email from workflows.** Add **Gmail** in Integrations (address + Google app password), then use the **Send Email** node: plain text or HTML, attachments from your library or generated images. New Send Email nodes start in preview mode, so runs show the email without sending it until you switch preview off.

**Account email.** Set `SYSTEM_MAIL_USER` / `SYSTEM_MAIL_PASSWORD` (a Gmail app password) for email verification and password reset. Without them, in development the emails and their links are printed to the `pnpm dev` console.

**Semantic search.** With an OpenAI key (yours in Integrations, or `OPENAI_API_KEY`), the worker embeds assets and library search also matches by meaning ("purple dashboard" finds "violet analytics screen"). Run `pnpm assets:reindex` once for existing assets. Without a key, search is keyword-only and says so.

AI nodes use the signed-in user's own OpenAI key (Integrations page) or, if none is connected, the server's `OPENAI_API_KEY`. With neither, AI nodes fail with a clear message; everything else (inputs, conditions, transforms, HTTP, outputs) runs.

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
| `pnpm secrets:rotate` | Re-encrypt stored API keys after changing `ENCRYPTION_KEY` (see `.env.example`) |

Tests use `TEST_DATABASE_URL`, or `DATABASE_URL` with the database name suffixed `_test`. They refuse to run against any other database.
