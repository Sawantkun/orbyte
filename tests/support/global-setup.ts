import { execSync } from "node:child_process";

/** Apply migrations to the dedicated test database before any test runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL not set");
  if (!/_test\b/.test(new URL(url).pathname)) {
    throw new Error("Refusing to run tests against a database whose name does not end in _test");
  }
  execSync("pnpm prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
