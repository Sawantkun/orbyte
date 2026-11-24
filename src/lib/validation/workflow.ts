import { z } from "zod";
import { LIMITS, workflowDefinitionSchema } from "@/lib/workflow/schema";
import { STARTERS } from "@/lib/workflow/starters";

const name = z.string().trim().min(1, "Name is required").max(LIMITS.maxNameLength);
const description = z.string().trim().max(1000);

export const createWorkflowSchema = z.object({
  name,
  description: description.optional(),
  starter: z.enum(STARTERS.map((s) => s.id) as [string, ...string[]]).default("blank"),
});

export const updateWorkflowSchema = z
  .object({
    name: name.optional(),
    description: description.nullable().optional(),
    definition: workflowDefinitionSchema.optional(),
    /** Optimistic concurrency: the `updatedAt` the client last saw. */
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.definition !== undefined, {
    message: "Nothing to update",
  });

export const publishWorkflowSchema = z.object({
  expectedUpdatedAt: z.iso.datetime().optional(),
});

export const listWorkflowsQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export const promptTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).optional(),
  content: z.string().min(1, "Template content is required").max(LIMITS.maxTextLength),
});

export const updatePromptTemplateSchema = promptTemplateSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: "Nothing to update",
});

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type ListWorkflowsQuery = z.infer<typeof listWorkflowsQuery>;
export type PromptTemplateInput = z.infer<typeof promptTemplateSchema>;

export const executeWorkflowSchema = z.object({
  inputs: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

export const listExecutionsQuery = z.object({
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
  workflowId: z.string().max(40).optional(),
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
