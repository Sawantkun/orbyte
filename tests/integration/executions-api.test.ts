import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Queue, Worker } from "bullmq";
import * as execute from "@/app/api/workflows/[id]/execute/route";
import * as publish from "@/app/api/workflows/[id]/publish/route";
import * as workflows from "@/app/api/workflows/route";
import * as list from "@/app/api/executions/route";
import * as detail from "@/app/api/executions/[id]/route";
import * as cancel from "@/app/api/executions/[id]/cancel/route";
import * as retry from "@/app/api/executions/[id]/retry/route";
import { db } from "@/lib/db";
import { runExecution } from "@/server/engine/executor";
import { NodeError } from "@/server/engine/errors";
import * as queueModule from "@/server/queue";
import { json, params, request, signedInUser } from "../support/api";
import { resetDatabase } from "../support/db";

// Route handlers use the real enqueue → stub it so these tests don't need a worker.
const enqueued: string[] = [];
vi.spyOn(queueModule, "enqueueExecution").mockImplementation(async (id: string) => {
  enqueued.push(id);
});

async function publishedWorkflow(cookie: string, starter = "text") {
  const res = await workflows.POST(request("/api/workflows", { method: "POST", cookie, body: { name: "Runnable", starter } }), {} as never);
  const wf = (await res.json()).data;
  await publish.POST(request(`/api/workflows/${wf.id}/publish`, { method: "POST", cookie, body: {} }), params({ id: wf.id }));
  return wf.id as string;
}

const run = (cookie: string, id: string, body: unknown) => execute.POST(request(`/api/workflows/${id}/execute`, { method: "POST", cookie, body }), params({ id }));

beforeEach(async () => {
  enqueued.length = 0;
  await resetDatabase();
});

describe("executions API", () => {
  it("refuses unpublished workflows and validates inputs against the version schema", async () => {
    const { cookie } = await signedInUser();
    const res = await workflows.POST(request("/api/workflows", { method: "POST", cookie, body: { name: "Draft", starter: "text" } }), {} as never);
    const draftId = (await res.json()).data.id;
    expect((await run(cookie, draftId, { inputs: { topic: "x" } })).status).toBe(409);

    const id = await publishedWorkflow(cookie);
    const bad = await run(cookie, id, { inputs: {} });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatchObject({ code: "INVALID_INPUTS", details: { fieldErrors: { topic: "Required" } } });
    expect(enqueued).toHaveLength(0);
  });

  it("creates an execution with pending node rows and enqueues it", async () => {
    const { cookie } = await signedInUser();
    const id = await publishedWorkflow(cookie);
    const res = await run(cookie, id, { inputs: { topic: "otters", ignored: 1 } });
    expect(res.status).toBe(201);
    const exec = (await res.json()).data;
    expect(exec).toMatchObject({ status: "PENDING", version: 1, trigger: "MANUAL", workflowName: "Runnable" });
    expect(enqueued).toEqual([exec.id]);
    const row = await db.workflowExecution.findUniqueOrThrow({ where: { id: exec.id }, include: { nodeExecutions: true } });
    expect(row.input).toEqual({ topic: "otters" });
    expect(row.nodeExecutions.map((n) => n.status)).toEqual(["PENDING", "PENDING", "PENDING", "PENDING"]);
  });

  it("deduplicates with an idempotency key", async () => {
    const { cookie } = await signedInUser();
    const id = await publishedWorkflow(cookie);
    const body = { inputs: { topic: "x" }, idempotencyKey: "click-123456" };
    const [a, b] = await Promise.all([run(cookie, id, body), run(cookie, id, body)]);
    const ids = [(await a.json()).data.id, (await b.json()).data.id];
    expect(ids[0]).toBe(ids[1]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await db.workflowExecution.count()).toBe(1);
  });

  it("isolates executions between users", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    const id = await publishedWorkflow(alice.cookie);
    const exec = (await (await run(alice.cookie, id, { inputs: { topic: "x" } })).json()).data;
    const p = params({ id: exec.id });
    expect((await run(bob.cookie, id, { inputs: { topic: "x" } })).status).toBe(404);
    expect((await detail.GET(request(`/api/executions/${exec.id}`, { cookie: bob.cookie }), p)).status).toBe(404);
    expect((await cancel.POST(request(`/api/executions/${exec.id}/cancel`, { method: "POST", cookie: bob.cookie }), p)).status).toBe(404);
    expect((await retry.POST(request(`/api/executions/${exec.id}/retry`, { method: "POST", cookie: bob.cookie }), p)).status).toBe(404);
    expect((await json(await list.GET(request("/api/executions", { cookie: bob.cookie }), {} as never))).data).toEqual([]);
  });

  it("cancels pending runs immediately, refuses finished ones, and retries failures", async () => {
    const { cookie } = await signedInUser();
    const id = await publishedWorkflow(cookie);
    const exec = (await (await run(cookie, id, { inputs: { topic: "x" } })).json()).data;
    const p = params({ id: exec.id });

    const c = await cancel.POST(request(`/api/executions/${exec.id}/cancel`, { method: "POST", cookie }), p);
    expect((await c.json()).data.status).toBe("CANCELLED");
    expect((await cancel.POST(request(`/api/executions/${exec.id}/cancel`, { method: "POST", cookie }), p)).status).toBe(409);

    const r = await retry.POST(request(`/api/executions/${exec.id}/retry`, { method: "POST", cookie }), p);
    expect(r.status).toBe(201);
    const retried = (await r.json()).data;
    expect(retried).toMatchObject({ status: "PENDING", trigger: "RETRY" });
    expect((await db.workflowExecution.findUniqueOrThrow({ where: { id: retried.id } })).retryOfId).toBe(exec.id);
    expect((await retry.POST(request(`/api/executions/${retried.id}/retry`, { method: "POST", cookie }), params({ id: retried.id }))).status).toBe(409);
  });

  it("returns full detail with node runs after execution", async () => {
    const { cookie } = await signedInUser();
    const id = await publishedWorkflow(cookie);
    const exec = (await (await run(cookie, id, { inputs: { topic: "x" } })).json()).data;
    await runExecution(exec.id, {
      providers: {
        text: async () => {
          throw new NodeError("PROVIDER_NOT_CONFIGURED", "OpenAI isn't configured.", false);
        },
        image: async () => {
          throw new NodeError("PROVIDER_NOT_CONFIGURED", "OpenAI isn't configured.", false);
        },
      },
      nodeConcurrency: 2,
      nodeTimeoutMs: 1000,
      maxAttempts: 1,
    });
    const d = (await json(await detail.GET(request(`/api/executions/${exec.id}`, { cookie }), params({ id: exec.id })))).data;
    expect(d.status).toBe("FAILED");
    expect(d.error.code).toBe("PROVIDER_NOT_CONFIGURED");
    expect(d.definition.nodes).toHaveLength(4);
    expect(d.nodes.map((n: { nodeType: string; status: string }) => `${n.nodeType}:${n.status}`).sort()).toEqual([
      "ai_text:FAILED",
      "input:COMPLETED",
      "output:SKIPPED",
      "prompt_template:COMPLETED",
    ]);
    const filtered = await json(await list.GET(request(`/api/executions?status=FAILED&workflowId=${id}`, { cookie }), {} as never));
    expect(filtered.data.map((e: { id: string }) => e.id)).toEqual([exec.id]);
  });

  it("marks the execution failed and returns 503 when the queue is down", async () => {
    const { cookie } = await signedInUser();
    const id = await publishedWorkflow(cookie);
    vi.mocked(queueModule.enqueueExecution).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await run(cookie, id, { inputs: { topic: "x" } });
    expect(res.status).toBe(503);
    const row = await db.workflowExecution.findFirstOrThrow();
    expect(row.status).toBe("FAILED");
    expect(row.error).toMatchObject({ code: "QUEUE_UNAVAILABLE" });
  });
});

describe("BullMQ queue round-trip (real Redis)", () => {
  const name = `orbyte-test-${Date.now()}`;
  const queue = new Queue(name, { connection: { url: "redis://localhost:6379" } });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it("collapses duplicate jobs by executionId and delivers once", async () => {
    await queue.add("run", { executionId: "abc" }, { jobId: "abc" });
    await queue.add("run", { executionId: "abc" }, { jobId: "abc" });
    const seen: string[] = [];
    const worker = new Worker(name, async (job) => void seen.push(job.data.executionId), { connection: { url: "redis://localhost:6379", maxRetriesPerRequest: null } });
    await new Promise((r) => setTimeout(r, 500));
    await worker.close();
    expect(seen).toEqual(["abc"]);
  });
});
