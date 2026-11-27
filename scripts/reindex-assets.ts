/**
 * Index every asset for semantic search (skips ones already up to date).
 * Usage: pnpm assets:reindex
 */
import { db } from "@/lib/db";
import { indexAsset } from "@/server/embeddings";

const counts: Record<string, number> = {};
let cursor: string | undefined;
for (;;) {
  const batch = await db.asset.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: 200, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  if (!batch.length) break;
  for (const { id } of batch) {
    try {
      const r = await indexAsset(id);
      counts[r] = (counts[r] ?? 0) + 1;
    } catch (e) {
      counts.failed = (counts.failed ?? 0) + 1;
      console.warn(`[reindex] ${id}: ${(e as Error).message}`);
    }
  }
  cursor = batch[batch.length - 1].id;
}
console.log("[reindex] done", counts);
await db.$disconnect();
