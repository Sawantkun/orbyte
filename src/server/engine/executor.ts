import "server-only";
import { estimateCost } from "@/config/ai-models";
import { Prisma, type ExecutionStatus, type NodeExecution } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { redact } from "@/lib/engine/redact";
import type { Scope } from "@/lib/engine/resolve";
import { NODE_SPECS } from "@/lib/workflow/registry";
import { NODE_CONFIG_SCHEMAS, workflowDefinitionSchema, type WorkflowDefinition, type WorkflowNode } from "@/lib/workflow/schema";
import { validateWorkflow } from "@/lib/workflow/validate";
import { recordActivity } from "../activity";
import { createAsset } from "../assets/service";
import { kindForMime } from "../assets/files";
import type { ProviderResolver } from "../providers/types";
import { NodeError, toNodeError } from "./errors";
import { runHandler, type AnnotateAssets, type LogLevel, type SaveAsset } from "./handlers";
import type { LookupFn } from "./safe-http";

/**
 * Executes one WorkflowExecution against its immutable WorkflowVersion.
 *
 * Scheduling: a node becomes ready when every predecessor is settled. It runs
 * if at least one incoming edge is "active" (source completed and, for a
 * Condition, on the taken branch); otherwise it is SKIPPED. Nodes without
 * incoming edges always run. Up to `nodeConcurrency` nodes run at once.
 *
 * Failure is fail-fast: no new nodes start, in-flight nodes are aborted, and
 * everything unsettled becomes SKIPPED.
 *
 * Idempotent & resumable: re-running a finished execution is a no-op; a
 * RUNNING execution (e.g. worker crash, stalled job) resumes using the
 * persisted node results.
 */
export type EngineDeps = {
  providers: ProviderResolver;
  nodeConcurrency: number;
  nodeTimeoutMs: number;
  maxAttempts: number;
  backoffMs?: (attempt: number) => number;
  cancelPollMs?: number;
  httpLookup?: LookupFn;
};

type LogEntry = { ts: string; level: LogLevel; message: string; data?: Record<string, unknown> };
type Settled = "COMPLETED" | "SKIPPED" | "FAILED";

const FINAL: ExecutionStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];
const MAX_STORED_JSON = 256 * 1024;
const MAX_LOGS = 200;

const defaultBackoff = (attempt: number) => Math.min(500 * 2 ** (attempt - 1), 8000);
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Keep persisted JSON bounded; the in-memory value used downstream is untouched. */
function forStorage(value: unknown, secrets: string[]): Prisma.InputJsonValue {
  const clean = redact(value ?? null, secrets);
  const json = JSON.stringify(clean);
  if (json === undefined) return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  if (json.length <= MAX_STORED_JSON) return clean as Prisma.InputJsonValue;
  return { truncated: true, bytes: json.length, preview: json.slice(0, 10_000) };
}

const errorJson = (e: NodeError, secrets: string[]) => redact({ code: e.code, message: e.message }, secrets);

export async function runExecution(executionId: string, deps: EngineDeps): Promise<ExecutionStatus> {
  const exec = await db.workflowExecution.findUnique({
    where: { id: executionId },
    include: { workflowVersion: { select: { definition: true, version: true } }, workflow: { select: { name: true } }, nodeExecutions: true },
  });
  if (!exec) throw new Error(`Execution ${executionId} not found`);
  if (FINAL.includes(exec.status)) return exec.status;

  const ownerId = exec.ownerId;
  const startedAt = exec.startedAt ?? new Date();
  const secrets: string[] = [];

  const finalize = async (status: ExecutionStatus, extra: { output?: unknown; error?: { code: string; message: string } } = {}) => {
    // Unsettled nodes can never run now.
    await db.nodeExecution.updateMany({ where: { executionId, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "SKIPPED", finishedAt: new Date() } });
    const nodes = await db.nodeExecution.findMany({ where: { executionId }, select: { inputTokens: true, outputTokens: true, costUsd: true } });
    const costs = nodes.map((n) => n.costUsd).filter((c): c is Prisma.Decimal => c !== null);
    const finishedAt = new Date();
    await db.workflowExecution.update({
      where: { id: executionId },
      data: {
        status,
        finishedAt,
        startedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        inputTokens: nodes.reduce((s, n) => s + n.inputTokens, 0),
        outputTokens: nodes.reduce((s, n) => s + n.outputTokens, 0),
        estimatedCostUsd: costs.length ? costs.reduce((a, b) => a.add(b), new Prisma.Decimal(0)) : null,
        output: extra.output === undefined ? undefined : forStorage(extra.output, secrets),
        error: extra.error ? (redact(extra.error, secrets) as Prisma.InputJsonValue) : undefined,
      },
    });
    const action = status === "COMPLETED" ? "execution.completed" : status === "FAILED" ? "execution.failed" : "execution.cancelled";
    await recordActivity({ ownerId, action, entityType: "execution", entityId: executionId, metadata: { name: exec.workflow.name } });
    return status;
  };

  if (exec.cancelRequestedAt) return finalize("CANCELLED");

  // ── Load and re-validate the immutable definition ─────────────────────────
  const parsedDef = workflowDefinitionSchema.safeParse(exec.workflowVersion.definition);
  if (!parsedDef.success) return finalize("FAILED", { error: { code: "INVALID_DEFINITION", message: "This workflow version could not be read." } });
  const def: WorkflowDefinition = parsedDef.data;
  const validation = validateWorkflow(def);
  if (!validation.valid) {
    const first = validation.issues.find((i) => i.severity === "error");
    return finalize("FAILED", { error: { code: "INVALID_WORKFLOW", message: first?.message ?? "Workflow is invalid" } });
  }

  const claimed = await db.workflowExecution.updateMany({
    where: { id: executionId, status: { in: ["PENDING", "RUNNING"] } },
    data: { status: "RUNNING", startedAt },
  });
  if (claimed.count === 0) return (await db.workflowExecution.findUniqueOrThrow({ where: { id: executionId } })).status;
  if (exec.status === "RUNNING") {
    // Resuming after a crash: attempts that were in flight did not finish.
    await db.nodeExecution.updateMany({
      where: { executionId, status: "RUNNING" },
      data: { status: "FAILED", finishedAt: new Date(), error: { code: "INTERRUPTED", message: "The worker stopped while this node was running" } },
    });
  }

  // ── Graph structures ──────────────────────────────────────────────────────
  const nodesById = new Map(def.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, { source: string; handle: string }[]>(def.nodes.map((n) => [n.id, []]));
  for (const e of def.edges) {
    const src = nodesById.get(e.source)!;
    const handle = e.sourceHandle ?? NODE_SPECS[src.type].outputs[0];
    incoming.get(e.target)!.push({ source: e.source, handle });
  }

  // ── Restore state from persisted node rows (resume support) ───────────────
  const latest = new Map<string, NodeExecution>();
  for (const row of exec.nodeExecutions) {
    const prev = latest.get(row.nodeId);
    if (!prev || row.attempt > prev.attempt) latest.set(row.nodeId, row);
  }
  const state = new Map<string, Settled>();
  const outputs = new Map<string, Record<string, unknown>>();
  const scope: Scope = { inputs: (exec.input as Record<string, unknown>) ?? {}, outputs: {} };
  for (const [nodeId, row] of latest) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    if (row.status === "COMPLETED" && row.output && typeof row.output === "object" && !("truncated" in row.output)) {
      state.set(nodeId, "COMPLETED");
      outputs.set(nodeId, row.output as Record<string, unknown>);
      scope.outputs[node.data.key] = row.output as Record<string, unknown>;
    } else if (row.status === "SKIPPED") {
      state.set(nodeId, "SKIPPED");
    }
  }

  // ── Cancellation ──────────────────────────────────────────────────────────
  const abort = new AbortController();
  let cancelled = false;
  let failure: NodeError | null = null;
  const poll = setInterval(async () => {
    try {
      const row = await db.workflowExecution.findUnique({ where: { id: executionId }, select: { cancelRequestedAt: true } });
      if (row?.cancelRequestedAt && !cancelled) {
        cancelled = true;
        abort.abort();
      }
    } catch {
      /* transient DB error: try again next tick */
    }
  }, deps.cancelPollMs ?? 1000);

  const isActive = (edge: { source: string; handle: string }) => {
    if (state.get(edge.source) !== "COMPLETED") return false;
    const src = nodesById.get(edge.source)!;
    if (src.type !== "condition") return true;
    return (outputs.get(edge.source)?.result === true ? "true" : "false") === edge.handle;
  };

  // ── Asset helpers bound to this execution's provenance ────────────────────
  const ownedCollection = async (collectionId: string | null | undefined, log: (l: LogLevel, m: string) => void) => {
    if (!collectionId) return null;
    const c = await db.assetCollection.findFirst({ where: { id: collectionId, ownerId }, select: { id: true } });
    if (!c) log("warn", "The selected collection no longer exists; saving without a collection");
    return c?.id ?? null;
  };
  const saveAssetFor =
    (node: WorkflowNode, log: (l: LogLevel, m: string) => void): SaveAsset =>
    async (input) => {
      const a = await createAsset(ownerId, {
        ...input,
        collectionId: await ownedCollection(input.collectionId, log),
        kind: kindForMime(input.mimeType),
        source: "WORKFLOW",
        workflowId: exec.workflowId,
        executionId,
        nodeId: node.id,
        tags: [],
      });
      return { id: a.id, name: a.name, mimeType: a.mimeType };
    };
  const annotateAssetsFor =
    (log: (l: LogLevel, m: string) => void): AnnotateAssets =>
    async (assetIds, patch) => {
      // Only assets produced by this execution can be re-filed from a workflow.
      const rows = await db.asset.findMany({ where: { ownerId, executionId, id: { in: assetIds } }, select: { id: true, metadata: true } });
      const collectionId = patch.collectionId === undefined ? undefined : await ownedCollection(patch.collectionId, log);
      for (const r of rows) {
        await db.asset.update({
          where: { id: r.id },
          data: {
            ...(collectionId ? { collectionId } : {}),
            ...(patch.metadata ? { metadata: { ...((r.metadata as object) ?? {}), ...patch.metadata } as Prisma.InputJsonValue } : {}),
          },
        });
      }
      return rows.length;
    };

  // ── Run one node with retries and a timeout ───────────────────────────────
  const runNode = async (node: WorkflowNode): Promise<void> => {
    const config = NODE_CONFIG_SCHEMAS[node.type].parse(node.data.config);
    const prev = latest.get(node.id);
    let attempt = prev ? (prev.status === "PENDING" ? prev.attempt : prev.attempt + 1) : 1;

    for (; ; attempt++) {
      const logs: LogEntry[] = [];
      const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
        if (logs.length < MAX_LOGS) logs.push({ ts: new Date().toISOString(), level, message, ...(data ? { data } : {}) });
      };
      const started = new Date();
      const row = await db.nodeExecution.upsert({
        where: { executionId_nodeId_attempt: { executionId, nodeId: node.id, attempt } },
        create: { executionId, nodeId: node.id, nodeType: node.type, attempt, status: "RUNNING", startedAt: started },
        update: { status: "RUNNING", startedAt: started },
      });

      const nodeAbort = new AbortController();
      const onParentAbort = () => nodeAbort.abort();
      abort.signal.addEventListener("abort", onParentAbort, { once: true });
      const timeoutMs = node.type === "http_request" ? Math.max((config as { timeoutMs: number }).timeoutMs + 2000, 5000) : deps.nodeTimeoutMs;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        nodeAbort.abort();
      }, timeoutMs);

      try {
        const result = await Promise.race([
          runHandler(node.type, config, {
            ownerId,
            saveAsset: saveAssetFor(node, log),
            annotateAssets: annotateAssetsFor(log),
            node,
            scope,
            signal: nodeAbort.signal,
            timeoutMs,
            providers: deps.providers,
            log,
            addSecrets: (s) => secrets.push(...s),
            httpLookup: deps.httpLookup,
          }),
          new Promise<never>((_, reject) =>
            nodeAbort.signal.addEventListener("abort", () =>
              reject(timedOut ? new NodeError("TIMEOUT", `Timed out after ${Math.round(timeoutMs / 1000)} s`, true) : new NodeError("CANCELLED", "Cancelled", false)),
            ),
          ),
        ]);

        const finished = new Date();
        const usage = result.usage;
        const cost = usage ? estimateCost(usage.provider, usage.model, usage.inputTokens, usage.outputTokens) : null;
        await db.$transaction([
          db.nodeExecution.update({
            where: { id: row.id },
            data: {
              status: "COMPLETED",
              input: forStorage(result.input, secrets),
              output: forStorage(result.output, secrets),
              logs: forStorage(logs, secrets),
              finishedAt: finished,
              durationMs: finished.getTime() - started.getTime(),
              inputTokens: usage?.inputTokens ?? 0,
              outputTokens: usage?.outputTokens ?? 0,
              costUsd: cost,
            },
          }),
          ...(usage
            ? [
                db.usageRecord.create({
                  data: {
                    ownerId,
                    provider: usage.provider,
                    model: usage.model,
                    executionId,
                    nodeExecutionId: row.id,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    imageCount: usage.imageCount ?? 0,
                    costUsd: cost,
                  },
                }),
              ]
            : []),
        ]);
        state.set(node.id, "COMPLETED");
        outputs.set(node.id, result.output);
        scope.outputs[node.data.key] = result.output;
        return;
      } catch (e) {
        const err = cancelled ? new NodeError("CANCELLED", "Execution was cancelled", false) : toNodeError(e);
        log("error", err.message, { code: err.code });
        const finished = new Date();
        await db.nodeExecution.update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            error: errorJson(err, secrets),
            logs: forStorage(logs, secrets),
            finishedAt: finished,
            durationMs: finished.getTime() - started.getTime(),
          },
        });
        const canRetry = err.retryable && attempt < deps.maxAttempts && !cancelled && !failure;
        if (!canRetry) {
          state.set(node.id, "FAILED");
          if (!cancelled && !failure) failure = new NodeError(err.code, `${node.data.label}: ${err.message}`, false);
          return;
        }
        await sleep(err.retryAfterMs ?? (deps.backoffMs ?? defaultBackoff)(attempt), abort.signal);
      } finally {
        clearTimeout(timer);
        abort.signal.removeEventListener("abort", onParentAbort);
      }
    }
  };

  // ── Scheduler loop ────────────────────────────────────────────────────────
  const running = new Map<string, Promise<void>>();
  try {
    for (;;) {
      if (!failure && !cancelled) {
        for (const node of def.nodes) {
          if (state.has(node.id) || running.has(node.id)) continue;
          const ins = incoming.get(node.id)!;
          if (!ins.every((e) => state.has(e.source))) continue;
          if (ins.length > 0 && !ins.some(isActive)) {
            state.set(node.id, "SKIPPED");
            await db.nodeExecution.updateMany({ where: { executionId, nodeId: node.id, status: "PENDING" }, data: { status: "SKIPPED", finishedAt: new Date() } });
            continue;
          }
          if (running.size >= deps.nodeConcurrency) continue;
          const p = runNode(node).finally(() => running.delete(node.id));
          running.set(node.id, p);
        }
      }
      if (failure && running.size > 0) abort.abort(); // fail fast
      if (running.size === 0) {
        // Skipping may have unlocked more nodes; loop until nothing changes.
        const pending = def.nodes.some((n) => !state.has(n.id));
        if (!pending || failure || cancelled) break;
        const progress = def.nodes.some((n) => !state.has(n.id) && incoming.get(n.id)!.every((e) => state.has(e.source)));
        if (!progress) break;
        continue;
      }
      await Promise.race(running.values());
    }
  } finally {
    clearInterval(poll);
  }

  if (cancelled) return finalize("CANCELLED", { error: { code: "CANCELLED", message: "Execution was cancelled" } });
  if (failure) return finalize("FAILED", { error: { code: (failure as NodeError).code, message: (failure as NodeError).message } });

  const result: Record<string, unknown> = {};
  for (const node of def.nodes) {
    if (node.type === "output" && state.get(node.id) === "COMPLETED") {
      const out = outputs.get(node.id)!;
      result[out.name as string] = out.value;
    }
  }
  return finalize("COMPLETED", { output: result });
}
