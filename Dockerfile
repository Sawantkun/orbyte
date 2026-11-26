# syntax=docker/dockerfile:1.7
# Orbyte — one Dockerfile, three targets:
#   docker build --target app     -t orbyte-app .
#   docker build --target worker  -t orbyte-worker .
#   docker build --target migrate -t orbyte-migrate .

ARG NODE_VERSION=24.11.0

# ── Dependencies ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
ENV CI=1 COREPACK_HOME=/opt/corepack
# Pre-fetch the pinned pnpm so non-root stages never download at runtime.
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate && chmod -R a+rX /opt/corepack
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs `prisma generate` (needs the schema, not a database).
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# Placeholder values so env validation passes while Next collects route modules.
# Nothing connects at build time; real values are provided at runtime.
ENV NODE_ENV=production \
    BUILD_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime \
    BETTER_AUTH_URL=http://localhost:3000 \
    APPLICATION_URL=http://localhost:3000 \
    ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
RUN pnpm build

# ── Web app (standalone Next.js server) ─────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /app/.storage && chown node:node /app/.storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ── Worker (executes workflows) ──────────────────────────────────────────────
FROM build AS worker
ENV NODE_ENV=production WORKER_HEALTH_PORT=3101
RUN mkdir -p /app/.storage && chown -R node:node /app/.storage
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3101/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "worker:start"]

# ── Migrations (run once per deploy, before app/worker) ─────────────────────
FROM deps AS migrate
ENV NODE_ENV=production
USER node
CMD ["pnpm", "prisma", "migrate", "deploy"]
