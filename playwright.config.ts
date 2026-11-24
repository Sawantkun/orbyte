import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost:5432/orbyte");
  url.pathname = url.pathname.replace(/(_test)?$/, "_test");
  return url.toString();
}
process.env.TEST_DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build for fidelity; separate distDir so it never collides with `next dev`.
    command: `pnpm next build && pnpm next start -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      BETTER_AUTH_URL: BASE_URL,
      APPLICATION_URL: BASE_URL,
      NEXT_DIST_DIR: ".next-e2e",
      // E2E creates many accounts from one IP; limits are covered elsewhere.
      AUTH_RATE_LIMIT: "off",
    },
  },
});
