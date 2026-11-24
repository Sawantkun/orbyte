/**
 * Development seed. Creates a demo account with a small, realistic history so
 * the dashboard can be exercised locally. Refuses to run in production.
 *
 *   pnpm db:seed           → demo@orbyte.dev / orbyte-demo-password
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type AssetKind, type ExecutionStatus } from "../src/generated/prisma/client";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { estimateCost } from "../src/config/ai-models";
import { createAsset } from "../src/server/assets/service";

const MODEL = "gpt-6-luna";
const COST = String(estimateCost("openai", MODEL, 600, 900));

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const EMAIL = "demo@orbyte.dev";
const PASSWORD = "orbyte-demo-password";
const day = 86_400_000;

async function main() {
  // Remove the previous demo user's stored files too.
  const old = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (old) {
    const { deleteAssets } = await import("../src/server/assets/service");
    const ids = (await db.asset.findMany({ where: { ownerId: old.id }, select: { id: true } })).map((a) => a.id);
    if (ids.length) await deleteAssets(old.id, ids);
  }
  await db.user.deleteMany({ where: { email: EMAIL } });
  const user = await db.user.create({
    data: {
      name: "Demo Creator",
      email: EMAIL,
      emailVerified: true,
    },
  });
  // Better Auth's credential account uses the user id as accountId.
  await db.account.create({
    data: { userId: user.id, providerId: "credential", accountId: user.id, password: await hashPassword(PASSWORD) },
  });

  const flows = ["Product launch copy", "Blog hero images", "Support reply drafts"];
  const statuses: ExecutionStatus[] = ["COMPLETED", "COMPLETED", "COMPLETED", "FAILED", "COMPLETED", "CANCELLED"];
  const kinds: AssetKind[] = ["IMAGE", "IMAGE", "TEXT", "JSON", "IMAGE", "TEXT", "TEXT"];
  const PALETTE = ["#8b5cf6", "#22c55e", "#f59e0b", "#38bdf8", "#a78bfa"];

  for (const [i, name] of flows.entries()) {
    const wf = await db.workflow.create({
      data: { ownerId: user.id, name, status: i === 2 ? "DRAFT" : "ACTIVE", definition: { schemaVersion: 1, nodes: [], edges: [] }, latestVersion: 1 },
    });
    const v = await db.workflowVersion.create({ data: { workflowId: wf.id, version: 1, definition: { schemaVersion: 1, nodes: [], edges: [] }, createdById: user.id } });
    for (let d = 0; d < 14; d++) {
      const runs = (d * 7 + i * 3) % 4;
      for (let r = 0; r < runs; r++) {
        const createdAt = new Date(Date.now() - d * day - r * 3_600_000);
        const status = statuses[(d + r + i) % statuses.length];
        const ex = await db.workflowExecution.create({
          data: {
            ownerId: user.id, workflowId: wf.id, workflowVersionId: v.id, status, createdAt,
            startedAt: createdAt, finishedAt: new Date(createdAt.getTime() + 4200), durationMs: 1500 + ((d * 977 + r * 331) % 9000),
            inputTokens: 600, outputTokens: 900, estimatedCostUsd: status === "COMPLETED" ? COST : null,
          },
        });
        if (status === "COMPLETED") {
          await db.usageRecord.create({ data: { ownerId: user.id, provider: "openai", model: MODEL, executionId: ex.id, inputTokens: 600, outputTokens: 900, costUsd: COST, createdAt } });
          if (r === 0) {
            const kind = kinds[(d + i) % kinds.length];
            // Real files through the real asset service (storage + thumbnails).
            const file =
              kind === "IMAGE"
                ? { buffer: await sharp({ create: { width: 640, height: 400, channels: 3, background: PALETTE[(d + i) % PALETTE.length] } }).png().toBuffer(), mimeType: "image/png", extension: "png" }
                : kind === "JSON"
                  ? { buffer: Buffer.from(JSON.stringify({ workflow: name, day: d }, null, 2)), mimeType: "application/json", extension: "json" }
                  : { buffer: Buffer.from(`${name} — sample output for day ${d + 1}.`), mimeType: "text/plain", extension: "txt" };
            const asset = await createAsset(user.id, {
              name: `${name} — output ${d + 1}.${file.extension}`,
              ...file,
              kind: kind === "PDF" ? "TEXT" : kind,
              source: "WORKFLOW",
              workflowId: wf.id,
              executionId: ex.id,
              nodeId: "seed",
              originalPrompt: `Generate ${name.toLowerCase()}`,
              aiProvider: "openai",
              aiModel: MODEL,
            });
            await db.asset.update({ where: { id: asset.id }, data: { createdAt } });
          }
        }
      }
    }
    await db.activityLog.create({ data: { ownerId: user.id, action: "workflow.created", entityType: "workflow", entityId: wf.id, metadata: { name } } });
  }
  await db.activityLog.create({ data: { ownerId: user.id, action: "asset.generated", entityType: "asset", metadata: { name: "Blog hero images — output 1" } } });
  console.log(`Seeded ${EMAIL} / ${PASSWORD}`);
}

main().finally(() => db.$disconnect());
