import "server-only";
import { Prisma, type ExecutionStatus, type NodeExecutionStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { coerceInputs } from "@/lib/engine/inputs";
import { workflowDefinitionSchema, type InputField, type WorkflowDefinition } from "@/lib/workflow/schema";
import { recordActivity } from "./activity";
import { AppError, conflict, notFound } from "./errors";
import { enqueueExecution } from "./queue";

/** Injected in tests; defaults to the BullMQ queue. */
export type Enqueue = (executionId: string) => Promise<void>;

export type ExecutionSummary = {
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  status: ExecutionStatus;
  trigger: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
};

export type NodeRun = {
  id: string;
  nodeId: string;
  nodeType: string;
  status: NodeExecutionStatus;
  attempt: number;
  input: unknown;
  output: unknown;
  error: { code: string; message: string } | null;
  logs: { ts: string; level: string; message: string; data?: unknown }[];
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type ExecutionDetail = ExecutionSummary & {
  input: unknown;
  output: unknown;
  error: { code: string; message: string } | null;
  cancelRequested: boolean;
  retryOfId: string | null;
  definition: WorkflowDefinition;
  nodes: NodeRun[];
};

const summaryInclude = { workflow: { select: { name: true } }, workflowVersion: { select: { version: true } } } as const;
type SummaryRow = Prisma.WorkflowExecutionGetPayload<{ include: typeof summaryInclude }>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

function toSummary(e: SummaryRow): ExecutionSummary {
  return {
    id: e.id,
    workflowId: e.workflowId,
    workflowName: e.workflow.name,
    version: e.workflowVersion.version,
    status: e.status,
    trigger: e.trigger,
    createdAt: e.createdAt.toISOString(),
    startedAt: iso(e.startedAt),
    finishedAt: iso(e.finishedAt),
    durationMs: e.durationMs,
    inputTokens: e.inputTokens,
    outputTokens: e.outputTokens,
    estimatedCostUsd: num(e.estimatedCostUsd),
  };
}

/** Create the execution and its PENDING node rows atomically, then enqueue. */
async function createAndEnqueue(
  ownerId: string,
  data: { workflowId: string; versionId: string; definition: WorkflowDefinition; input: Record<string, unknown>; trigger: "MANUAL" | "RETRY"; retryOfId?: string; idempotencyKey?: string },
  enqueue: Enqueue,
) {
  const execution = await db.$transaction(async (tx) => {
    const created = await tx.workflowExecution.create({
      data: {
        ownerId,
        workflowId: data.workflowId,
        workflowVersionId: data.versionId,
        trigger: data.trigger,
        retryOfId: data.retryOfId,
        idempotencyKey: data.idempotencyKey,
        input: data.input as Prisma.InputJsonValue,
      },
      include: summaryInclude,
    });
    await tx.nodeExecution.createMany({
      data: data.definition.nodes.map((n) => ({ executionId: created.id, nodeId: n.id, nodeType: n.type, attempt: 1 })),
    });
    return created;
  });

  try {
    await enqueue(execution.id);
  } catch (e) {
    console.error("[executions] enqueue failed", { executionId: execution.id, name: (e as Error)?.name });
    await db.workflowExecution.update({
      where: { id: execution.id },
      data: { status: "FAILED", finishedAt: new Date(), error: { code: "QUEUE_UNAVAILABLE", message: "The execution queue is unavailable. Try again shortly." } },
    });
    throw new AppError(503, "QUEUE_UNAVAILABLE", "The execution queue is unavailable. Try again shortly.");
  }
  await recordActivity({ ownerId, action: "execution.started", entityType: "execution", entityId: execution.id, metadata: { name: execution.workflow.name } });
  return toSummary(execution);
}

export async function startExecution(
  ownerId: string,
  workflowId: string,
  body: { inputs: Record<string, unknown>; idempotencyKey?: string },
  enqueue: Enqueue = enqueueExecution,
): Promise<{ execution: ExecutionSummary; created: boolean }> {
  const wf = await db.workflow.findFirst({ where: { id: workflowId, ownerId }, select: { id: true, latestVersion: true } });
  if (!wf) throw notFound("Workflow");
  if (wf.latestVersion === 0) throw conflict("Publish this workflow before running it.");

  if (body.idempotencyKey) {
    const existing = await db.workflowExecution.findFirst({ where: { ownerId, idempotencyKey: body.idempotencyKey }, include: summaryInclude });
    if (existing) {
      if (existing.workflowId !== workflowId) throw conflict("This idempotency key was used for a different workflow.");
      return { execution: toSummary(existing), created: false };
    }
  }

  const version = await db.workflowVersion.findUniqueOrThrow({
    where: { workflowId_version: { workflowId, version: wf.latestVersion } },
    select: { id: true, definition: true },
  });
  const definition = workflowDefinitionSchema.parse(version.definition);
  const schema = ((version.definition as { inputSchema?: InputField[] }).inputSchema ?? []) as InputField[];
  const { values, errors } = coerceInputs(schema, body.inputs);
  if (Object.keys(errors).length) throw new AppError(400, "INVALID_INPUTS", "Some inputs are missing or invalid.", { fieldErrors: errors });

  try {
    const execution = await createAndEnqueue(ownerId, { workflowId, versionId: version.id, definition, input: values, trigger: "MANUAL", idempotencyKey: body.idempotencyKey }, enqueue);
    return { execution, created: true };
  } catch (e) {
    // Lost a race on the same idempotency key: return the winner.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && body.idempotencyKey) {
      const existing = await db.workflowExecution.findFirstOrThrow({ where: { ownerId, idempotencyKey: body.idempotencyKey }, include: summaryInclude });
      return { execution: toSummary(existing), created: false };
    }
    throw e;
  }
}

export async function listExecutions(
  ownerId: string,
  q: { status?: ExecutionStatus; workflowId?: string; cursor?: string; limit: number },
): Promise<{ items: ExecutionSummary[]; nextCursor: string | null }> {
  const rows = await db.workflowExecution.findMany({
    where: { ownerId, ...(q.status ? { status: q.status } : {}), ...(q.workflowId ? { workflowId: q.workflowId } : {}) },
    include: summaryInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, q.limit).map(toSummary);
  return { items, nextCursor: rows.length > q.limit ? items[items.length - 1].id : null };
}

export async function getExecution(ownerId: string, id: string): Promise<ExecutionDetail> {
  const e = await db.workflowExecution.findFirst({
    where: { id, ownerId },
    include: { ...summaryInclude, workflowVersion: { select: { version: true, definition: true } }, nodeExecutions: { orderBy: [{ createdAt: "asc" }, { attempt: "asc" }] } },
  });
  if (!e) throw notFound("Execution");
  const parsed = workflowDefinitionSchema.safeParse(e.workflowVersion.definition);
  return {
    ...toSummary(e),
    input: e.input,
    output: e.output,
    error: (e.error as ExecutionDetail["error"]) ?? null,
    cancelRequested: e.cancelRequestedAt !== null,
    retryOfId: e.retryOfId,
    definition: parsed.success ? parsed.data : { schemaVersion: 1, nodes: [], edges: [] },
    nodes: e.nodeExecutions.map((n) => ({
      id: n.id,
      nodeId: n.nodeId,
      nodeType: n.nodeType,
      status: n.status,
      attempt: n.attempt,
      input: n.input,
      output: n.output,
      error: (n.error as NodeRun["error"]) ?? null,
      logs: Array.isArray(n.logs) ? (n.logs as NodeRun["logs"]) : [],
      startedAt: iso(n.startedAt),
      finishedAt: iso(n.finishedAt),
      durationMs: n.durationMs,
      inputTokens: n.inputTokens,
      outputTokens: n.outputTokens,
      costUsd: num(n.costUsd),
    })),
  };
}

/** PENDING executions are cancelled immediately; RUNNING ones are flagged and stopped by the worker. */
export async function cancelExecution(ownerId: string, id: string): Promise<ExecutionSummary> {
  const e = await db.workflowExecution.findFirst({ where: { id, ownerId }, select: { status: true } });
  if (!e) throw notFound("Execution");
  if (e.status === "PENDING") {
    await db.$transaction([
      db.workflowExecution.updateMany({
        where: { id, ownerId, status: "PENDING" },
        data: { status: "CANCELLED", cancelRequestedAt: new Date(), finishedAt: new Date(), error: { code: "CANCELLED", message: "Execution was cancelled" } },
      }),
      db.nodeExecution.updateMany({ where: { executionId: id, status: "PENDING" }, data: { status: "SKIPPED" } }),
    ]);
  } else if (e.status === "RUNNING") {
    await db.workflowExecution.updateMany({ where: { id, ownerId, status: "RUNNING" }, data: { cancelRequestedAt: new Date() } });
  } else {
    throw conflict(`This execution has already ${e.status.toLowerCase()}.`);
  }
  return toSummary(await db.workflowExecution.findFirstOrThrow({ where: { id, ownerId }, include: summaryInclude }));
}

/** Re-run a failed or cancelled execution with the same version and inputs. */
export async function retryExecution(ownerId: string, id: string, enqueue: Enqueue = enqueueExecution): Promise<ExecutionSummary> {
  const e = await db.workflowExecution.findFirst({
    where: { id, ownerId },
    select: { status: true, workflowId: true, workflowVersionId: true, input: true, workflowVersion: { select: { definition: true } } },
  });
  if (!e) throw notFound("Execution");
  if (e.status !== "FAILED" && e.status !== "CANCELLED") throw conflict("Only failed or cancelled executions can be retried.");
  const definition = workflowDefinitionSchema.parse(e.workflowVersion.definition);
  return createAndEnqueue(
    ownerId,
    { workflowId: e.workflowId, versionId: e.workflowVersionId, definition, input: (e.input as Record<string, unknown>) ?? {}, trigger: "RETRY", retryOfId: id },
    enqueue,
  );
}
