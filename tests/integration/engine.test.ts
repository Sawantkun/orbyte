import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NODE_SPECS } from "@/lib/workflow/registry";
import { deriveInputSchema, type NodeType, type WorkflowDefinition, type WorkflowNode } from "@/lib/workflow/schema";
import { NodeError } from "@/server/engine/errors";
import { runExecution, type EngineDeps } from "@/server/engine/executor";
import { startExecution } from "@/server/executions";
import type { ProviderResolver, TextGenerationRequest } from "@/server/providers/types";
import { createUser, resetDatabase } from "../support/db";

// ── Fixtures ────────────────────────────────────────────────────────────────
const n = (id: string, type: NodeType, key: string, config: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { key, label: id, config: { ...NODE_SPECS[type].defaultConfig(), ...config } },
});
const e = (source: string, target: string, sourceHandle = "out") => ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle, targetHandle: "in" });
const def = (nodes: WorkflowNode[], edges: ReturnType<typeof e>[]): WorkflowDefinition => ({ schemaVersion: 1, nodes, edges });

type Script = (req: TextGenerationRequest, call: number) => Promise<string> | string;
function fakeProviders(script: Script, secret = "sk-test-SECRET-1234567890abcdef") {
  const calls: TextGenerationRequest[] = [];
  const resolver: ProviderResolver = {
    async image() {
      throw new NodeError("PROVIDER_UNSUPPORTED", "no images in this fake", false);
    },
    async text() {
      return {
        secrets: [secret],
        provider: {
          id: "openai",
          async generateText(req) {
            calls.push(req);
            const text = await script(req, calls.length);
            return { text, usage: { inputTokens: 100, outputTokens: 50 }, truncated: false };
          },
        },
      };
    },
  };
  return { resolver, calls };
}

const deps = (providers: ProviderResolver, over: Partial<EngineDeps> = {}): EngineDeps => ({
  providers,
  nodeConcurrency: 4,
  nodeTimeoutMs: 2000,
  maxAttempts: 3,
  backoffMs: () => 1,
  cancelPollMs: 25,
  ...over,
});

async function setup(definition: WorkflowDefinition, inputs: Record<string, unknown> = {}) {
  const user = await createUser();
  const wf = await db.workflow.create({ data: { ownerId: user.id, name: "Engine test", definition: definition as unknown as Prisma.InputJsonValue, latestVersion: 1, status: "ACTIVE" } });
  await db.workflowVersion.create({
    data: { workflowId: wf.id, version: 1, createdById: user.id, definition: { ...definition, inputSchema: deriveInputSchema(definition) } as unknown as Prisma.InputJsonValue },
  });
  const { execution } = await startExecution(user.id, wf.id, { inputs }, async () => {});
  return { user, executionId: execution.id };
}

const nodeRows = (executionId: string) => db.nodeExecution.findMany({ where: { executionId }, orderBy: [{ nodeId: "asc" }, { attempt: "asc" }] });
const statusOf = async (executionId: string) => Object.fromEntries((await nodeRows(executionId)).map((r) => [`${r.nodeId}#${r.attempt}`, r.status]));

const TEXT_FLOW = def(
  [
    n("in", "input", "input_1", { fieldName: "topic" }),
    n("p", "prompt_template", "prompt_1", { template: "Write about {{topic}}" }),
    n("t", "ai_text", "text_1", { prompt: "{{prompt_1.text}}", systemPrompt: "Be brief" }),
    n("o", "output", "output_1", { name: "draft", value: "{{text_1.text}}" }),
  ],
  [e("in", "p"), e("p", "t"), e("t", "o")],
);

beforeEach(resetDatabase);

describe("runExecution", () => {
  it("runs a text workflow end to end with usage, cost and outputs", async () => {
    const { resolver, calls } = fakeProviders((req) => `Echo: ${req.prompt}`);
    const { executionId, user } = await setup(TEXT_FLOW, { topic: "otters" });

    expect(await runExecution(executionId, deps(resolver))).toBe("COMPLETED");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "gpt-6.2-sol", system: "Be brief", prompt: "Write about otters", temperature: undefined });
    const exec = await db.workflowExecution.findUniqueOrThrow({ where: { id: executionId } });
    expect(exec.output).toEqual({ draft: "Echo: Write about otters" });
    expect(exec.inputTokens).toBe(100);
    expect(exec.outputTokens).toBe(50);
    // gpt-6.2-sol: $2 / $10 per 1M → 100*2/1e6 + 50*10/1e6 = 0.0007
    expect(Number(exec.estimatedCostUsd)).toBeCloseTo(0.0007, 8);
    expect(exec.durationMs).toBeGreaterThanOrEqual(0);
    expect(await statusOf(executionId)).toEqual({ "in#1": "COMPLETED", "o#1": "COMPLETED", "p#1": "COMPLETED", "t#1": "COMPLETED" });
    const usage = await db.usageRecord.findMany({ where: { ownerId: user.id } });
    expect(usage).toHaveLength(1);
    expect(Number(usage[0].costUsd)).toBeCloseTo(0.0007, 8);
    expect(await db.activityLog.count({ where: { ownerId: user.id, action: "execution.completed" } })).toBe(1);
  });

  it("is idempotent once finished", async () => {
    const { resolver, calls } = fakeProviders(() => "x");
    const { executionId } = await setup(TEXT_FLOW, { topic: "a" });
    await runExecution(executionId, deps(resolver));
    expect(await runExecution(executionId, deps(resolver))).toBe("COMPLETED");
    expect(calls).toHaveLength(1);
  });

  it("runs independent branches concurrently, respecting the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const { resolver } = fakeProviders(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 60));
      active--;
      return "ok";
    });
    const nodes = [n("in", "input", "input_1"), ...[1, 2, 3, 4].map((i) => n(`t${i}`, "ai_text", `text_${i}`, { prompt: "{{topic}}" }))];
    const edges = [1, 2, 3, 4].map((i) => e("in", `t${i}`));
    const { executionId } = await setup(def(nodes, edges), { topic: "x" });

    await runExecution(executionId, deps(resolver, { nodeConcurrency: 2 }));
    expect(peak).toBe(2);

    const { executionId: second } = await setup(def(nodes, edges), { topic: "x" });
    peak = 0;
    await runExecution(second, deps(resolver, { nodeConcurrency: 4 }));
    expect(peak).toBe(4);
  });

  it("follows the taken condition branch and skips the other", async () => {
    const { resolver } = fakeProviders(() => "unused");
    const d = def(
      [
        n("in", "input", "input_1", { fieldName: "score", fieldType: "number" }),
        n("c", "condition", "check", { left: "{{score}}", operator: "greater_than", right: "50" }),
        n("hi", "transform", "high", { operation: "template", input: "pass {{score}}" }),
        n("lo", "transform", "low", { operation: "template", input: "fail {{score}}" }),
        n("lo2", "transform", "low_after", { operation: "uppercase", input: "{{low.result}}" }),
        n("o1", "output", "out_hi", { name: "pass", value: "{{high.result}}" }),
        n("o2", "output", "out_lo", { name: "fail", value: "{{low_after.result}}" }),
      ],
      [e("in", "c"), e("c", "hi", "true"), e("c", "lo", "false"), e("lo", "lo2"), e("hi", "o1"), e("lo2", "o2")],
    );
    const { executionId } = await setup(d, { score: "72" });
    expect(await runExecution(executionId, deps(resolver))).toBe("COMPLETED");
    const s = await statusOf(executionId);
    expect(s).toMatchObject({ "c#1": "COMPLETED", "hi#1": "COMPLETED", "o1#1": "COMPLETED", "lo#1": "SKIPPED", "lo2#1": "SKIPPED", "o2#1": "SKIPPED" });
    expect((await db.workflowExecution.findUniqueOrThrow({ where: { id: executionId } })).output).toEqual({ pass: "pass 72" });
  });

  it("runs a join node when at least one incoming branch is active", async () => {
    const d = def(
      [
        n("in", "input", "input_1", { fieldName: "flag", fieldType: "boolean" }),
        n("c", "condition", "check", { left: "{{flag}}", operator: "equals", right: "true" }),
        n("a", "transform", "a", { operation: "template", input: "A" }),
        n("b", "transform", "b", { operation: "template", input: "B" }),
        n("o", "output", "out", { name: "joined", value: "{{a.result}}{{b.result}}" }),
      ],
      [e("in", "c"), e("c", "a", "true"), e("c", "b", "false"), e("a", "o"), e("b", "o")],
    );
    const { resolver } = fakeProviders(() => "");
    const { executionId } = await setup(d, { flag: false });
    expect(await runExecution(executionId, deps(resolver))).toBe("COMPLETED");
    expect((await db.workflowExecution.findUniqueOrThrow({ where: { id: executionId } })).output).toEqual({ joined: "B" });
  });

  it("retries retryable failures with new attempt rows, then succeeds", async () => {
    const { resolver, calls } = fakeProviders((_req, call) => {
      if (call < 3) throw new NodeError("PROVIDER_RATE_LIMIT", "rate limited", true);
      return "finally";
    });
    const { executionId } = await setup(TEXT_FLOW, { topic: "x" });
    expect(await runExecution(executionId, deps(resolver))).toBe("COMPLETED");
    expect(calls).toHaveLength(3);
    const rows = (await nodeRows(executionId)).filter((r) => r.nodeId === "t");
    expect(rows.map((r) => [r.attempt, r.status, (r.error as { code?: string } | null)?.code ?? null])).toEqual([
      [1, "FAILED", "PROVIDER_RATE_LIMIT"],
      [2, "FAILED", "PROVIDER_RATE_LIMIT"],
      [3, "COMPLETED", null],
    ]);
  });

  it("does not retry non-retryable errors; fails fast and skips downstream", async () => {
    const { resolver, calls } = fakeProviders(() => {
      throw new NodeError("PROVIDER_AUTH", "bad key", false);
    });
    const { executionId } = await setup(TEXT_FLOW, { topic: "x" });
    expect(await runExecution(executionId, deps(resolver))).toBe("FAILED");
    expect(calls).toHaveLength(1);
    const exec = await db.workflowExecution.findUniqueOrThrow({ where: { id: executionId } });
    expect(exec.error).toEqual({ code: "PROVIDER_AUTH", message: "t: bad key" });
    expect(await statusOf(executionId)).toMatchObject({ "t#1": "FAILED", "o#1": "SKIPPED" });
  });

  it("stops after maxAttempts on persistent retryable errors", async () => {
    const { resolver, calls } = fakeProviders(() => {
      throw new NodeError("PROVIDER_ERROR", "503", true);
    });
    const { executionId } = await setup(TEXT_FLOW, { topic: "x" });
    expect(await runExecution(executionId, deps(resolver, { maxAttempts: 2 }))).toBe("FAILED");
    expect(calls).toHaveLength(2);
  });

  it("times out slow nodes", async () => {
    const { resolver } = fakeProviders(() => new Promise(() => {})); // never resolves
    const { executionId } = await setup(TEXT_FLOW, { topic: "x" });
    expect(await runExecution(executionId, deps(resolver, { nodeTimeoutMs: 100, maxAttempts: 1 }))).toBe("FAILED");
    const t = (await nodeRows(executionId)).find((r) => r.nodeId === "t")!;
    expect(t.error).toMatchObject({ code: "TIMEOUT" });
  });

  it("cancels a running execution and aborts in-flight provider calls", async () => {
    let aborted = false;
    const { resolver } = fakeProviders(
      (req) =>
        new Promise((_, reject) => {
          req.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new NodeError("CANCELLED", "aborted", false));
          });
        }),
    );
    const { executionId } = await setup(TEXT_FLOW, { topic: "x" });
    const run = runExecution(executionId, deps(resolver));
    await new Promise((r) => setTimeout(r, 150));
    await db.workflowExecution.update({ where: { id: executionId }, data: { cancelRequestedAt: new Date() } });
    expect(await run).toBe("CANCELLED");
    expect(aborted).toBe(true);
    expect(await statusOf(executionId)).toMatchObject({ "t#1": "FAILED", "o#1": "SKIPPED" });
  });

  it("resumes a RUNNING execution after a crash without redoing completed work", async () => {
    const { resolver, calls } = fakeProviders(() => "resumed");
    const { executionId } = await setup(TEXT_FLOW, { topic: "x" });
    // Simulate a worker that died after finishing input + prompt and while running the AI node.
    await db.workflowExecution.update({ where: { id: executionId }, data: { status: "RUNNING", startedAt: new Date() } });
    await db.nodeExecution.updateMany({ where: { executionId, nodeId: "in" }, data: { status: "COMPLETED", output: { value: "x" } } });
    await db.nodeExecution.updateMany({ where: { executionId, nodeId: "p" }, data: { status: "COMPLETED", output: { text: "from before crash" } } });
    await db.nodeExecution.updateMany({ where: { executionId, nodeId: "t" }, data: { status: "RUNNING" } });

    expect(await runExecution(executionId, deps(resolver))).toBe("COMPLETED");
    expect(calls.map((c) => c.prompt)).toEqual(["from before crash"]);
    const t = (await nodeRows(executionId)).filter((r) => r.nodeId === "t");
    expect(t.map((r) => [r.attempt, r.status, (r.error as { code?: string } | null)?.code ?? null])).toEqual([
      [1, "FAILED", "INTERRUPTED"],
      [2, "COMPLETED", null],
    ]);
  });

  it("never persists provider secrets in inputs, outputs or logs", async () => {
    const secret = "sk-test-SECRET-1234567890abcdef";
    const { resolver } = fakeProviders(() => `the key is ${secret}`, secret);
    const d = def(
      [
        n("in", "input", "input_1", { fieldName: "topic" }),
        n("t", "ai_text", "text_1", { prompt: "{{topic}}" }),
        n("o", "output", "output_1", { name: "draft", value: "{{text_1.text}}" }),
      ],
      [e("in", "t"), e("t", "o")],
    );
    const { executionId } = await setup(d, { topic: `use ${secret}` });
    await runExecution(executionId, deps(resolver));
    const blobs = JSON.stringify([await nodeRows(executionId), await db.workflowExecution.findUniqueOrThrow({ where: { id: executionId }, select: { output: true, error: true } })]);
    expect(blobs).not.toContain(secret);
    expect(blobs).toContain("[redacted]");
  });

  it("finalizes an execution cancelled before it started", async () => {
    const { resolver, calls } = fakeProviders(() => "x");
    const { executionId } = await setup(TEXT_FLOW, { topic: "x" });
    await db.workflowExecution.update({ where: { id: executionId }, data: { cancelRequestedAt: new Date() } });
    expect(await runExecution(executionId, deps(resolver))).toBe("CANCELLED");
    expect(calls).toHaveLength(0);
  });
});
