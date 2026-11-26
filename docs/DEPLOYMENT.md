# Deploying Orbyte

Orbyte runs as three processes plus two backing services:

| Component | What it does | Image target |
|---|---|---|
| **app** | Next.js web app and API (standalone server, port 3000) | `app` |
| **worker** | Executes workflows from the Redis queue | `worker` |
| **migrate** | Applies database migrations, then exits | `migrate` |
| PostgreSQL 15+ | All metadata | — |
| Redis 7+ | Execution queue and rate limits | — |
| Object storage | Asset files: S3-compatible bucket, or a shared volume on a single host | — |

## Quick start (single host, Docker Compose)

```bash
cat > .env.production <<'ENV'
APPLICATION_URL=https://orbyte.example.com
POSTGRES_PASSWORD=<strong password>
BETTER_AUTH_SECRET=<openssl rand -base64 32>
ENCRYPTION_KEY=<openssl rand -base64 32>
# Optional: platform OpenAI key used when a user has not connected their own
OPENAI_API_KEY=
ENV
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

`migrate` runs first; `app` and `worker` start once it succeeds. Put a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) in front of port 3000.

## Building images

```bash
docker build --target app     -t orbyte-app .
docker build --target worker  -t orbyte-worker .
docker build --target migrate -t orbyte-migrate .
```

CI builds all three and smoke-tests the app image (sign-up, upload, thumbnail, range request, CSP header) on every pull request.

## Configuration checklist

| Variable | Notes |
|---|---|
| `APPLICATION_URL`, `BETTER_AUTH_URL` | Public https origin. Enables HSTS and `upgrade-insecure-requests`; also used for the API's Origin check, so it must match the URL users actually visit. |
| `BETTER_AUTH_SECRET` | ≥ 32 random characters. Rotating it signs everyone out. |
| `ENCRYPTION_KEY` | 32 random bytes, base64. **Back it up.** Losing it makes stored provider keys unrecoverable. Rotate with `ENCRYPTION_KEY_PREVIOUS` + `pnpm secrets:rotate` (see `.env.example`). |
| `DATABASE_URL`, `REDIS_URL` | Use TLS URLs for managed services. |
| `STORAGE_PROVIDER=s3` + `STORAGE_*` | Required when running more than one app/worker host. The local adapter needs a volume shared by app and worker. |
| `AUTH_IP_HEADERS`, `TRUSTED_PROXIES` | Tell the login rate limiter which header holds the real client IP (e.g. `cf-connecting-ip`). Without this, limits key on whatever `X-Forwarded-For` says. |
| `WORKER_CONCURRENCY`, `EXECUTION_NODE_CONCURRENCY`, `EXECUTION_NODE_TIMEOUT_MS`, `EXECUTION_MAX_ATTEMPTS` | Worker throughput and resilience. |
| `MAX_UPLOAD_BYTES` | Per-file upload cap (default 50 MB). Uploads stream to a temp directory, so this is disk, not memory. Make sure your proxy's body limit is at least this. |

## Operations

* **Health:** `GET /api/health` (app, checks the database) and `GET /health` on `WORKER_HEALTH_PORT` (worker). Both images define Docker `HEALTHCHECK`s.
* **Scaling:** app and worker scale horizontally. Rate limits and the queue live in Redis; files must be in S3-compatible storage.
* **Deploys:** run `migrate` before rolling out new app/worker images. Workers finish in-flight jobs on `SIGTERM` (compose allows 2 minutes). A job interrupted harder is re-delivered by BullMQ and resumes from saved node state.
* **Backups:** PostgreSQL (all metadata, encrypted keys), the object store (asset files), and `ENCRYPTION_KEY`. Redis holds only transient data.
* **Logs:** stdout/stderr. API errors log a short `ref` that the user also sees; logs never contain secrets or storage keys.
