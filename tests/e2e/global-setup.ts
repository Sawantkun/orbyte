import { execSync } from "node:child_process";
import pg from "pg";

/** Migrate and empty the e2e database before the run. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL!;
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("E2E must use a *_test database");
  execSync("pnpm prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
  );
  if (rows.length) await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} CASCADE`);
  await client.end();
}
