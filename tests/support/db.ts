import { db } from "@/lib/db";

/** Truncate all application tables. Only ever runs against the _test database. */
export async function resetDatabase() {
  if (!process.env.DATABASE_URL?.includes("_test")) throw new Error("resetDatabase outside test DB");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

let n = 0;
export async function createUser(name = "Test User") {
  n += 1;
  return db.user.create({ data: { name, email: `user${n}-${Date.now()}@example.test` } });
}
