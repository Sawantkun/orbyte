# ADR-0001: Stack and version pinning

**Status:** accepted (Milestone 1)

* Next.js **16.4** — latest stable. Note: "middleware" is now `proxy.ts`; bundled docs live in `node_modules/next/dist/docs` (see AGENTS.md).
* Prisma **7.10** — npm's `latest` tag currently points to an 8.0 release candidate; we pin the latest stable 7.x. Prisma 7 requires `prisma.config.ts` and a driver adapter (`@prisma/adapter-pg`). The client is generated to `src/generated/prisma` (git-ignored, regenerated on `postinstall`).
* Better Auth **1.7**, Zod **4**, Tailwind **4**, shadcn/ui (Radix base, `radix-nova` style). shadcn now uses the `cn` package instead of `clsx` + `tailwind-merge`.
* Package manager **pnpm** with an explicit `allowBuilds` list in `pnpm-workspace.yaml`.
