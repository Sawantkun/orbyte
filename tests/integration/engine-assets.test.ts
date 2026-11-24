import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NODE_SPECS } from "@/lib/workflow/registry";
import { deriveInputSchema, type NodeType, type WorkflowDefinition, type WorkflowNode } from "@/lib/workflow/schema";
import { runExecution } from "@/server/engine/executor";
import { startExecution } from "@/server/executions";
import type { ImageGenerationRequest, ProviderResolver } from "@/server/providers/types";
import { createUser, resetDatabase } from "../support/db";
import { pngBytes } from "../support/files";

const n = (id: string, type: NodeType, key: string, config: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { key, label: id, config: { ...NODE_SPECS[type].defaultConfig(), ...config } },
});
const e = (source: string, target: string) => ({ id: `${source}-${target}`, source, target, sourceHandle: "out", targetHandle: "in" });

async function setup(definition: WorkflowDefinition, inputs: Record<string, unknown>) {
  const user = await createUser();
  const wf = await db.workflow.create({ data: { ownerId: user.id, name: "Hero images", definition: definition as unknown as Prisma.InputJsonValue, latestVersion: 1 } });
  await db.workflowVersion.create({
    data: { workflowId: wf.id, version: 1, createdById: user.id, definition: { ...definition, inputSchema: deriveInputSchema(definition) } as unknown as Prisma.InputJsonValue },
  });
  const { execution } = await startExecution(user.id, wf.id, { inputs }, async () => {});
  return { user, wf, executionId: execution.id };
}

function providers() {
  const imageCalls: ImageGenerationRequest[] = [];
  const resolver: ProviderResolver = {
    async text() {
      return { secrets: [], provider: { id: "openai", generateText: async (r) => ({ text: `About ${r.prompt}`, usage: { inputTokens: 10, outputTokens: 5 }, truncated: false }) } };
    },
    async image() {
      return {
        secrets: [],
        provider: {
          id: "openai",
          async generateImages(req) {
            imageCalls.push(req);
            const images = await Promise.all(Array.from({ length: req.count }, () => pngBytes(1536, 1024)));
            return { images: images.map((data) => ({ data, mimeType: "image/png" })), usage: { inputTokens: 20, outputTokens: 4000 } };
          },
        },
      };
    },
  };
  return { resolver, imageCalls };
}
const deps = (providers: ProviderResolver) => ({ providers, nodeConcurrency: 2, nodeTimeoutMs: 10_000, maxAttempts: 1, cancelPollMs: 50 });

beforeEach(resetDatabase);

describe("workflow outputs → asset library", () => {
  it("stores generated images as assets with full provenance, thumbnails, collection and cost", async () => {
    const { resolver, imageCalls } = providers();
    const d: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        n("in", "input", "input_1", { fieldName: "subject" }),
        n("img", "ai_image", "image_1", { prompt: "Futuristic {{subject}}", aspectRatio: "16:9", quality: "high", count: 2 }),
        n("o", "output", "output_1", { name: "heroes", format: "file", value: "{{image_1.images}}", saveToLibrary: true, metadata: [{ key: "campaign", value: "launch" }] }),
      ],
      edges: [e("in", "img"), e("img", "o")],
    };
    const { user, wf, executionId } = await setup(d, { subject: "dashboard" });
    const col = await db.assetCollection.create({ data: { ownerId: user.id, name: "Website" } });
    // Point the output at the collection via the stored version (as a published version would).
    const version = await db.workflowVersion.findFirstOrThrow({ where: { workflowId: wf.id } });
    const def = version.definition as unknown as WorkflowDefinition;
    def.nodes[2].data.config.collectionId = col.id;
    await db.workflowVersion.update({ where: { id: version.id }, data: { definition: def as unknown as Prisma.InputJsonValue } });

    expect(await runExecution(executionId, deps(resolver))).toBe("COMPLETED");
    expect(imageCalls[0]).toMatchObject({ prompt: "Futuristic dashboard", size: "1536x1024", quality: "high", count: 2 });

    const assets = await db.asset.findMany({ where: { ownerId: user.id }, orderBy: { name: "asc" } });
    expect(assets).toHaveLength(2);
    for (const a of assets) {
      expect(a).toMatchObject({
        kind: "IMAGE",
        source: "WORKFLOW",
        mimeType: "image/png",
        originalPrompt: "Futuristic dashboard",
        aiProvider: "openai",
        aiModel: "gpt-image-2.6-flare",
        workflowId: wf.id,
        executionId,
        nodeId: "img",
        collectionId: col.id,
      });
      expect(a.metadata).toMatchObject({ width: 1536, height: 1024, campaign: "launch", output: "heroes", size: "1536x1024" });
      expect(fs.existsSync(path.join(process.env.STORAGE_LOCAL_DIR!, a.thumbnailKey!))).toBe(true);
    }
    const exec = await db.workflowExecution.findUniqueOrThrow({ where: { id: executionId } });
    expect((exec.output as { heroes: { assetId: string }[] }).heroes.map((h) => h.assetId).sort()).toEqual(assets.map((a) => a.id).sort());
    // 20 * $5/1M + 4000 * $30/1M
    expect(Number(exec.estimatedCostUsd)).toBeCloseTo(0.1201, 6);
    expect((await db.usageRecord.findFirstOrThrow({ where: { executionId } })).imageCount).toBe(2);
    expect(await db.activityLog.count({ where: { ownerId: user.id, action: "asset.generated" } })).toBe(2);
  });

  it("saves text and JSON outputs as library files when asked", async () => {
    const { resolver } = providers();
    const d: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        n("in", "input", "input_1", { fieldName: "topic" }),
        n("t", "ai_text", "text_1", { prompt: "{{topic}}" }),
        n("o1", "output", "output_1", { name: "blog_draft", format: "text", value: "{{text_1.text}}", saveToLibrary: true }),
        n("o2", "output", "output_2", { name: "meta", format: "json", value: '{"topic":"{{topic}}"}', saveToLibrary: true }),
        n("o3", "output", "output_3", { name: "not_saved", format: "text", value: "x" }),
      ],
      edges: [e("in", "t"), e("t", "o1"), e("in", "o2"), e("in", "o3")],
    };
    const { user, executionId } = await setup(d, { topic: "otters" });
    expect(await runExecution(executionId, deps(resolver))).toBe("COMPLETED");
    const assets = await db.asset.findMany({ where: { ownerId: user.id }, orderBy: { name: "asc" } });
    expect(assets.map((a) => [a.name, a.kind, a.mimeType, a.nodeId])).toEqual([
      ["blog-draft.txt", "TEXT", "text/plain", "o1"],
      ["meta.json", "JSON", "application/json", "o2"],
    ]);
    const body = fs.readFileSync(path.join(process.env.STORAGE_LOCAL_DIR!, assets[1].storageKey), "utf8");
    expect(JSON.parse(body)).toEqual({ topic: "otters" });
  });

  it("ignores a collection that does not belong to the workflow owner", async () => {
    const { resolver } = providers();
    const stranger = await createUser("Stranger");
    const theirs = await db.assetCollection.create({ data: { ownerId: stranger.id, name: "Theirs" } });
    const d: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [n("in", "input", "input_1", { fieldName: "subject" }), n("img", "ai_image", "image_1", { prompt: "{{subject}}", collectionId: theirs.id })],
      edges: [e("in", "img")],
    };
    const { user, executionId } = await setup(d, { subject: "x" });
    expect(await runExecution(executionId, deps(resolver))).toBe("COMPLETED");
    const a = await db.asset.findFirstOrThrow({ where: { ownerId: user.id } });
    expect(a.collectionId).toBeNull();
    expect(await db.asset.count({ where: { collectionId: theirs.id } })).toBe(0);
    const logs = JSON.stringify((await db.nodeExecution.findFirstOrThrow({ where: { executionId, nodeId: "img" } })).logs);
    expect(logs).toContain("collection no longer exists");
  });
});
