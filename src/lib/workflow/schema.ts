import { z } from "zod";

/**
 * Workflow definition format (schemaVersion 1). Shared by the editor, the API
 * and (from Milestone 3) the execution worker. Structural validation lives
 * here; graph-level rules live in ./validate.ts.
 */

export const WORKFLOW_SCHEMA_VERSION = 1;
export const LIMITS = {
  maxNodes: 200,
  maxEdges: 500,
  maxTextLength: 20_000,
  maxNameLength: 120,
} as const;

export const NODE_TYPES = [
  "input",
  "ai_text",
  "ai_image",
  "prompt_template",
  "condition",
  "transform",
  "http_request",
  "output",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

const text = (max: number = LIMITS.maxTextLength) => z.string().max(max);
const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters, numbers and underscores, starting with a letter");
const keyValue = z.object({ key: text(200), value: text(4000) });

// ─── Per-node configuration ──────────────────────────────────────────────────

export const INPUT_FIELD_TYPES = ["text", "number", "boolean", "json", "file"] as const;

export const inputConfig = z.object({
  fieldName: identifier,
  fieldType: z.enum(INPUT_FIELD_TYPES),
  description: text(500).default(""),
  required: z.boolean().default(true),
  defaultValue: text(4000).default(""),
});

export const aiTextConfig = z.object({
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(80),
  systemPrompt: text().default(""),
  prompt: text(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxOutputTokens: z.number().int().min(1).max(32_000).default(1024),
});

export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
export const IMAGE_QUALITIES = ["standard", "high"] as const;

export const aiImageConfig = z.object({
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(80),
  prompt: text(),
  aspectRatio: z.enum(ASPECT_RATIOS).default("1:1"),
  quality: z.enum(IMAGE_QUALITIES).default("standard"),
  count: z.number().int().min(1).max(4).default(1),
  saveToLibrary: z.boolean().default(true),
});

export const promptTemplateConfig = z.object({
  /** Library template this was loaded from, if any (informational; content is copied in). */
  templateId: z.string().max(40).nullable().default(null),
  template: text(),
});

export const CONDITION_OPERATORS = ["equals", "not_equals", "contains", "greater_than", "less_than", "exists"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const conditionConfig = z.object({
  left: text(2000),
  operator: z.enum(CONDITION_OPERATORS),
  right: text(2000).default(""),
});

export const TRANSFORM_OPERATIONS = [
  "template",
  "trim",
  "uppercase",
  "lowercase",
  "truncate",
  "replace",
  "split",
  "join",
  "json_parse",
  "json_stringify",
  "json_get",
] as const;
export type TransformOperation = (typeof TRANSFORM_OPERATIONS)[number];

/** Declarative, sandbox-free transformations — no user code is ever executed. */
export const transformConfig = z.object({
  operation: z.enum(TRANSFORM_OPERATIONS),
  input: text(),
  /** Operation argument: length (truncate), separator (split/join), find (replace), path (json_get). */
  argument: text(500).default(""),
  /** Replacement text for `replace`. */
  replacement: text(2000).default(""),
});

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const httpRequestConfig = z.object({
  method: z.enum(HTTP_METHODS),
  url: text(2048),
  headers: z.array(keyValue).max(30).default([]),
  body: text().default(""),
  timeoutMs: z.number().int().min(1000).max(30_000).default(10_000),
  responseType: z.enum(["json", "text"]).default("json"),
});

export const OUTPUT_FORMATS = ["text", "json", "file"] as const;

export const outputConfig = z.object({
  name: identifier,
  format: z.enum(OUTPUT_FORMATS),
  value: text(),
  saveToLibrary: z.boolean().default(false),
  metadata: z.array(keyValue).max(20).default([]),
});

export const NODE_CONFIG_SCHEMAS = {
  input: inputConfig,
  ai_text: aiTextConfig,
  ai_image: aiImageConfig,
  prompt_template: promptTemplateConfig,
  condition: conditionConfig,
  transform: transformConfig,
  http_request: httpRequestConfig,
  output: outputConfig,
} as const satisfies Record<NodeType, z.ZodType>;

export type NodeConfigMap = { [K in NodeType]: z.infer<(typeof NODE_CONFIG_SCHEMAS)[K]> };

// ─── Graph ───────────────────────────────────────────────────────────────────

const position = z.object({ x: z.number().finite(), y: z.number().finite() });

/** Stored node: config is validated per type by validateWorkflow(), so drafts can hold incomplete config. */
export const workflowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(NODE_TYPES),
  position,
  data: z.object({
    key: z.string().max(40),
    label: z.string().max(80),
    config: z.record(z.string(), z.unknown()),
  }),
});

export const workflowEdgeSchema = z.object({
  id: z.string().min(1).max(160),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  sourceHandle: z.string().max(32).nullable().optional(),
  targetHandle: z.string().max(32).nullable().optional(),
});

export const workflowDefinitionSchema = z.object({
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  nodes: z.array(workflowNodeSchema).max(LIMITS.maxNodes),
  edges: z.array(workflowEdgeSchema).max(LIMITS.maxEdges),
  viewport: z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().min(0.05).max(4) }).optional(),
});

export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const emptyDefinition = (): WorkflowDefinition => ({ schemaVersion: WORKFLOW_SCHEMA_VERSION, nodes: [], edges: [] });

// ─── Input schema (derived) ──────────────────────────────────────────────────

export type InputField = {
  name: string;
  type: (typeof INPUT_FIELD_TYPES)[number];
  description: string;
  required: boolean;
  defaultValue: string;
};

/** The workflow's run-time inputs, derived from its Input nodes (in canvas order, top to bottom). */
export function deriveInputSchema(def: WorkflowDefinition): InputField[] {
  return def.nodes
    .filter((n) => n.type === "input")
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    .flatMap((n) => {
      const parsed = inputConfig.safeParse(n.data.config);
      if (!parsed.success) return [];
      const c = parsed.data;
      return [{ name: c.fieldName, type: c.fieldType, description: c.description, required: c.required, defaultValue: c.defaultValue }];
    });
}
