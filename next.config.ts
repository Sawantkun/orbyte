import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Orbyte is an authenticated, per-user app: nearly every route reads the
  // session at request time. We use classic dynamic rendering rather than
  // Cache Components (see docs/decisions/0002-rendering-model.md).
  // E2E builds use a separate output dir so they never clobber a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Self-contained server bundle for Docker (node .next/standalone/server.js).
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // file-type loads its tokenizer with a dynamic import() that Next's file
  // tracer cannot follow; include it (and its deps) so standalone builds work.
  outputFileTracingIncludes: {
    "/api/assets/upload": [
      "./node_modules/.pnpm/strtok3@*/node_modules/**",
      "./node_modules/.pnpm/token-types@*/node_modules/**",
      "./node_modules/.pnpm/@tokenizer+*/node_modules/**",
      "./node_modules/.pnpm/@borewit+text-codec@*/node_modules/**",
      "./node_modules/.pnpm/ieee754@*/node_modules/**",
      "./node_modules/.pnpm/uint8array-extras@*/node_modules/**",
    ],
  },
  poweredByHeader: false,
  devIndicators: { position: "bottom-right" },
  serverExternalPackages: ["@prisma/client", "pg", "bullmq", "ioredis", "sharp", "@aws-sdk/client-s3", "busboy", "file-type"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // SAMEORIGIN (not DENY) so asset previews such as PDFs can be framed by the app itself.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.APPLICATION_URL?.startsWith("https://")
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
