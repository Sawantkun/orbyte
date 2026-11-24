import "server-only";
import { Prisma, type WorkflowStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { CreateWorkflowInput, ListWorkflowsQuery, UpdateWorkflowInput } from "@/lib/validation/workflow";
import { deriveInputSchema, workflowDefinitionSchema, type InputField, type WorkflowDefinition } from "@/lib/workflow/schema";
import { starterDefinition, type StarterId } from "@/lib/workflow/starters";
import { validateWorkflow } from "@/lib/workflow/validate";
import { recordActivity } from "./activity";
import { conflict, notFound, unprocessable } from "./errors";

/**
 * Workflow service. Every function takes the caller's `ownerId` and scopes
 * every query by it; another user's id is indistinguishable from a missing one.
 */

export type WorkflowSummary = {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowDetail = WorkflowSummary & {
  definition: WorkflowDefinition;
  versions: VersionSummary[];
};

export type VersionSummary = { id: string; version: number; createdAt: string; nodeCount: number };

/** Stored version payload: the definition plus the derived input schema the worker will validate runs against. */
export type VersionDefinition = WorkflowDefinition & { inputSchema: InputField[] };

const summarySelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  latestVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;

type SummaryRow = Prisma.WorkflowGetPayload<{ select: typeof summarySelect }>;

const toSummary = (w: SummaryRow): WorkflowSummary => ({
  ...w,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

/**
 * Definitions are Zod-validated and originate from JSON, so they are always
 * JSON-serialisable; this is the single place we tell Prisma so.
 */
const asJson = (value: WorkflowDefinition | VersionDefinition) => value as unknown as Prisma.InputJsonValue;

/** Parse a stored definition defensively; corrupted rows surface as an empty canvas rather than a crash. */
function readDefinition(value: unknown): WorkflowDefinition {
  const parsed = workflowDefinitionSchema.safeParse(value);
  return parsed.success ? parsed.data : { schemaVersion: 1, nodes: [], edges: [] };
}

export async function listWorkflows(ownerId: string, query: ListWorkflowsQuery) {
  const where: Prisma.WorkflowWhereInput = {
    ownerId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { description: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const rows = await db.workflow.findMany({
    where,
    select: summarySelect,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit).map(toSummary);
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function getWorkflow(ownerId: string, id: string): Promise<WorkflowDetail> {
  const w = await db.workflow.findFirst({
    where: { id, ownerId },
    select: { ...summarySelect, definition: true },
  });
  if (!w) throw notFound("Workflow");
  const versions = await listVersions(ownerId, id);
  return { ...toSummary(w), definition: readDefinition(w.definition), versions };
}

export async function createWorkflow(ownerId: string, input: CreateWorkflowInput): Promise<WorkflowSummary> {
  const definition = starterDefinition(input.starter as StarterId);
  const w = await db.workflow.create({
    data: { ownerId, name: input.name, description: input.description || null, definition: asJson(definition) },
    select: summarySelect,
  });
  await recordActivity({ ownerId, action: "workflow.created", entityType: "workflow", entityId: w.id, metadata: { name: w.name } });
  return toSummary(w);
}

export async function updateWorkflow(ownerId: string, id: string, input: UpdateWorkflowInput): Promise<WorkflowSummary> {
  const data: Prisma.WorkflowUpdateManyMutationInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description || null;
  if (input.definition !== undefined) data.definition = asJson(input.definition);

  const where: Prisma.WorkflowWhereInput = { id, ownerId };
  if (input.expectedUpdatedAt) where.updatedAt = new Date(input.expectedUpdatedAt);

  const { count } = await db.workflow.updateMany({ where, data });
  if (count === 0) {
    const exists = await db.workflow.findFirst({ where: { id, ownerId }, select: { updatedAt: true } });
    if (!exists) throw notFound("Workflow");
    throw conflict("This workflow was changed elsewhere. Reload to get the latest version.", {
      currentUpdatedAt: exists.updatedAt.toISOString(),
    });
  }
  const w = await db.workflow.findFirstOrThrow({ where: { id, ownerId }, select: summarySelect });
  return toSummary(w);
}

export async function deleteWorkflow(ownerId: string, id: string): Promise<void> {
  const w = await db.workflow.findFirst({ where: { id, ownerId }, select: { name: true } });
  if (!w) throw notFound("Workflow");
  await db.workflow.deleteMany({ where: { id, ownerId } });
  await recordActivity({ ownerId, action: "workflow.deleted", entityType: "workflow", entityId: id, metadata: { name: w.name } });
}

export async function duplicateWorkflow(ownerId: string, id: string): Promise<WorkflowSummary> {
  const src = await db.workflow.findFirst({ where: { id, ownerId }, select: { name: true, description: true, definition: true } });
  if (!src) throw notFound("Workflow");
  const name = `${src.name} (copy)`.slice(0, 120);
  const w = await db.workflow.create({
    data: { ownerId, name, description: src.description, definition: src.definition ?? Prisma.JsonNull },
    select: summarySelect,
  });
  await recordActivity({ ownerId, action: "workflow.created", entityType: "workflow", entityId: w.id, metadata: { name } });
  return toSummary(w);
}

/**
 * Snapshot the saved draft into a new immutable version. Fails with 422 and
 * the validation issues when the graph is not runnable.
 */
export async function publishWorkflow(ownerId: string, id: string, expectedUpdatedAt?: string) {
  const w = await db.workflow.findFirst({
    where: { id, ownerId },
    select: { name: true, definition: true, latestVersion: true, updatedAt: true },
  });
  if (!w) throw notFound("Workflow");
  if (expectedUpdatedAt && w.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw conflict("This workflow was changed elsewhere. Reload before publishing.");
  }
  const definition = readDefinition(w.definition);
  const result = validateWorkflow(definition);
  if (!result.valid) {
    throw unprocessable("Fix the errors in this workflow before publishing.", {
      issues: result.issues.filter((i) => i.severity === "error"),
    });
  }

  const version = w.latestVersion + 1;
  const snapshot: VersionDefinition = { ...definition, inputSchema: deriveInputSchema(definition) };
  try {
    const created = await db.$transaction(async (tx) => {
      // Guard against concurrent publishes: only advance from the version we read.
      const { count } = await tx.workflow.updateMany({
        where: { id, ownerId, latestVersion: w.latestVersion },
        data: { latestVersion: version, status: "ACTIVE" },
      });
      if (count === 0) throw conflict("Another publish happened at the same time. Try again.");
      return tx.workflowVersion.create({
        data: { workflowId: id, version, definition: asJson(snapshot), createdById: ownerId },
        select: { id: true, version: true, createdAt: true },
      });
    });
    await recordActivity({ ownerId, action: "workflow.published", entityType: "workflow", entityId: id, metadata: { name: `${w.name} v${version}` } });
    const updated = await db.workflow.findFirstOrThrow({ where: { id, ownerId }, select: summarySelect });
    return {
      workflow: toSummary(updated),
      version: { ...created, createdAt: created.createdAt.toISOString() },
      warnings: result.issues.filter((i) => i.severity === "warning"),
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw conflict("Another publish happened at the same time. Try again.");
    }
    throw e;
  }
}

export async function listVersions(ownerId: string, workflowId: string): Promise<VersionSummary[]> {
  const rows = await db.workflowVersion.findMany({
    where: { workflowId, workflow: { ownerId } },
    orderBy: { version: "desc" },
    select: { id: true, version: true, createdAt: true, definition: true },
  });
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
    nodeCount: readDefinition(r.definition).nodes.length,
  }));
}

export async function getVersion(ownerId: string, workflowId: string, version: number) {
  const v = await db.workflowVersion.findFirst({
    where: { workflowId, version, workflow: { ownerId } },
    select: { id: true, version: true, createdAt: true, definition: true },
  });
  if (!v) throw notFound("Version");
  const raw = v.definition as { inputSchema?: InputField[] };
  return {
    id: v.id,
    version: v.version,
    createdAt: v.createdAt.toISOString(),
    definition: readDefinition(v.definition),
    inputSchema: Array.isArray(raw?.inputSchema) ? raw.inputSchema : [],
  };
}

/** Replace the draft with a published version's graph. The version itself is untouched. */
export async function restoreVersion(ownerId: string, workflowId: string, version: number): Promise<WorkflowSummary> {
  const v = await getVersion(ownerId, workflowId, version);
  const { count } = await db.workflow.updateMany({ where: { id: workflowId, ownerId }, data: { definition: asJson(v.definition) } });
  if (count === 0) throw notFound("Workflow");
  const w = await db.workflow.findFirstOrThrow({ where: { id: workflowId, ownerId }, select: summarySelect });
  return toSummary(w);
}
