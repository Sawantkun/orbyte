import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import os from "node:os";
import path from "node:path";

import "dotenv/config";

// Tests use a separate database: TEST_DATABASE_URL, or DATABASE_URL with the db name suffixed "_test".
function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error("Set TEST_DATABASE_URL or DATABASE_URL");
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = url.pathname.replace(/\/?$/, "").replace(/(_test)?$/, "_test");
  return url.toString();
}
const TEST_DATABASE_URL = testDatabaseUrl();
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` throws outside a React Server environment; it's a build-time guard only.
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
      BETTER_AUTH_URL: "http://localhost:3000",
      APPLICATION_URL: "http://localhost:3000",
      ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      STORAGE_PROVIDER: "local",
      STORAGE_LOCAL_DIR: path.join(os.tmpdir(), `orbyte-test-storage-${process.pid}`),
      MAX_UPLOAD_BYTES: String(2 * 1024 * 1024),
      // Emails are rendered into an in-memory outbox, never sent.
      MAIL_TRANSPORT: "json",
      // Semantic search is exercised with a fake embedder in tests.
      SEMANTIC_SEARCH: "off",
    },
  },
});
