import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Orbyte is an authenticated, per-user app: nearly every route reads the
  // session at request time. We use classic dynamic rendering rather than
  // Cache Components (see docs/decisions/0002-rendering-model.md).
  // E2E builds use a separate output dir so they never clobber a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  devIndicators: { position: "bottom-right" },
  serverExternalPackages: ["@prisma/client", "pg", "bullmq", "ioredis"],
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
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
