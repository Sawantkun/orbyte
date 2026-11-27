import { isKnownModel } from "@/config/ai-models";
import { NODE_SPECS } from "./registry";
import {
  NODE_CONFIG_SCHEMAS,
  type NodeType,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./schema";
import { collectStrings, extractRefs } from "./templates";
import { checkRequestUrl } from "./url-safety";

export type IssueSeverity = "error" | "warning";

export type ValidationIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  /** Config field the issue refers to, for the inspector. */
  field?: string;
};

export type ValidationResult = { valid: boolean; issues: ValidationIssue[] };

/** Config fields that must be non-empty for a runnable workflow. */
const REQUIRED_TEXT: Partial<Record<NodeType, { field: string; label: string }[]>> = {
  ai_text: [{ field: "prompt", label: "Prompt" }],
  ai_image: [{ field: "prompt", label: "Prompt" }],
  prompt_template: [{ field: "template", label: "Template" }],
  condition: [{ field: "left", label: "Value to check" }],
  transform: [{ field: "input", label: "Input" }],
  send_email: [
    { field: "to", label: "To" },
    { field: "subject", label: "Subject" },
    { field: "body", label: "Body" },
  ],
  output: [{ field: "value", label: "Value" }],
};

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
export const MAX_RECIPIENTS = 10;
export const splitRecipients = (to: string) => to.split(/[,;]/).map((r) => r.trim()).filter(Boolean);

/**
 * Validate a workflow graph for publishing/execution. Pure and deterministic:
 * used by the editor (live), the API (on publish) and the worker (before run).
 */
export function validateWorkflow(def: WorkflowDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];
  const err = (i: Omit<ValidationIssue, "severity">) => issues.push({ severity: "error", ...i });
  const warn = (i: Omit<ValidationIssue, "severity">) => issues.push({ severity: "warning", ...i });

  if (def.nodes.length === 0) {
    err({ code: "EMPTY", message: "Add at least one node." });
    return { valid: false, issues };
  }

  // ── Nodes: ids, keys, config ────────────────────────────────────────────
  const byId = new Map<string, WorkflowNode>();
  const keyOwner = new Map<string, string>(); // key → nodeId
  const inputFieldOwner = new Map<string, string>(); // fieldName → nodeId

  for (const node of def.nodes) {
    if (byId.has(node.id)) err({ code: "DUPLICATE_NODE_ID", message: `Duplicate node id "${node.id}".`, nodeId: node.id });
    byId.set(node.id, node);

    const key = node.data.key;
    if (!KEY_PATTERN.test(key)) {
      err({ code: "INVALID_KEY", message: `"${node.data.label}" needs a key of lowercase letters, numbers and underscores.`, nodeId: node.id, field: "key" });
    } else if (keyOwner.has(key)) {
      err({ code: "DUPLICATE_KEY", message: `Key "${key}" is used by more than one node.`, nodeId: node.id, field: "key" });
    } else keyOwner.set(key, node.id);

    const parsed = NODE_CONFIG_SCHEMAS[node.type].safeParse(node.data.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        err({
          code: "INVALID_CONFIG",
          message: `${node.data.label}: ${issue.path.length ? issue.path.join(".") + " — " : ""}${issue.message}`,
          nodeId: node.id,
          field: issue.path[0]?.toString(),
        });
      }
      continue;
    }
    const config = parsed.data as Record<string, unknown>;

    for (const req of REQUIRED_TEXT[node.type] ?? []) {
      const v = config[req.field];
      if (typeof v !== "string" || v.trim() === "") {
        err({ code: "REQUIRED", message: `${node.data.label}: ${req.label} is required.`, nodeId: node.id, field: req.field });
      }
    }

    if (node.type === "input") {
      const name = config.fieldName as string;
      if (inputFieldOwner.has(name)) {
        err({ code: "DUPLICATE_INPUT", message: `Input field "${name}" is defined twice.`, nodeId: node.id, field: "fieldName" });
      } else inputFieldOwner.set(name, node.id);
      const fieldType = config.fieldType as string;
      const dflt = (config.defaultValue as string).trim();
      if (dflt && fieldType === "number" && Number.isNaN(Number(dflt))) {
        err({ code: "INVALID_DEFAULT", message: `${node.data.label}: default value must be a number.`, nodeId: node.id, field: "defaultValue" });
      }
      if (dflt && fieldType === "boolean" && !["true", "false"].includes(dflt)) {
        err({ code: "INVALID_DEFAULT", message: `${node.data.label}: default must be true or false.`, nodeId: node.id, field: "defaultValue" });
      }
      if (dflt && fieldType === "json") {
        try {
          JSON.parse(dflt);
        } catch {
          err({ code: "INVALID_DEFAULT", message: `${node.data.label}: default value is not valid JSON.`, nodeId: node.id, field: "defaultValue" });
        }
      }
    }

    if (node.type === "ai_text" || node.type === "ai_image") {
      const capability = node.type === "ai_text" ? "text" : "image";
      if (!isKnownModel(config.provider as string, config.model as string, capability)) {
        err({ code: "UNKNOWN_MODEL", message: `${node.data.label}: choose a supported ${capability} model.`, nodeId: node.id, field: "model" });
      }
    }

    if (node.type === "http_request") {
      const check = checkRequestUrl(config.url as string);
      if (!check.ok) err({ code: "UNSAFE_URL", message: `${node.data.label}: ${check.reason}.`, nodeId: node.id, field: "url" });
      else if (check.dynamicHost)
        warn({ code: "DYNAMIC_HOST", message: `${node.data.label}: host comes from a variable and will be checked at run time.`, nodeId: node.id, field: "url" });
    }

    if (node.type === "send_email") {
      // Literal recipients are checked now; {{variables}} are checked when the workflow runs.
      const to = (config.to as string).trim();
      if (to && !to.includes("{{")) {
        const bad = splitRecipients(to).filter((r) => !EMAIL.test(r));
        if (bad.length) err({ code: "INVALID_EMAIL", message: `${node.data.label}: "${bad[0]}" isn't a valid email address.`, nodeId: node.id, field: "to" });
        else if (splitRecipients(to).length > MAX_RECIPIENTS) err({ code: "TOO_MANY_RECIPIENTS", message: `${node.data.label}: at most ${MAX_RECIPIENTS} recipients.`, nodeId: node.id, field: "to" });
      }
    }

    if (node.type === "transform") {
      const op = config.operation as string;
      const arg = (config.argument as string).trim();
      if (op === "truncate" && !/^\d+$/.test(arg)) {
        err({ code: "REQUIRED", message: `${node.data.label}: truncate needs a whole-number length.`, nodeId: node.id, field: "argument" });
      }
      if ((op === "replace" || op === "json_get") && arg === "") {
        err({ code: "REQUIRED", message: `${node.data.label}: ${op === "replace" ? "text to find" : "a JSON path"} is required.`, nodeId: node.id, field: "argument" });
      }
    }
  }

  for (const [name, nodeId] of inputFieldOwner) {
    if (keyOwner.has(name) && keyOwner.get(name) !== nodeId) {
      err({ code: "AMBIGUOUS_NAME", message: `"${name}" is both an input field and a node key.`, nodeId, field: "fieldName" });
    }
  }

  // ── Edges ───────────────────────────────────────────────────────────────
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const seenEdges = new Set<string>();
  for (const id of byId.keys()) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }

  for (const edge of def.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) {
      err({ code: "DANGLING_EDGE", message: "A connection points to a node that no longer exists.", edgeId: edge.id });
      continue;
    }
    if (source.id === target.id) {
      err({ code: "SELF_LOOP", message: `${source.data.label} cannot connect to itself.`, edgeId: edge.id, nodeId: source.id });
      continue;
    }
    const sSpec = NODE_SPECS[source.type];
    const tSpec = NODE_SPECS[target.type];
    const sourceHandle = edge.sourceHandle ?? (sSpec.outputs.length === 1 ? sSpec.outputs[0] : null);
    if (!sourceHandle || !sSpec.outputs.includes(sourceHandle)) {
      err({ code: "INVALID_HANDLE", message: `${source.data.label} has no output "${edge.sourceHandle ?? "?"}".`, edgeId: edge.id, nodeId: source.id });
      continue;
    }
    if (!tSpec.hasInput || (edge.targetHandle != null && edge.targetHandle !== "in")) {
      err({ code: "INVALID_HANDLE", message: `${target.data.label} does not accept incoming connections.`, edgeId: edge.id, nodeId: target.id });
      continue;
    }
    const sig = `${edge.source}:${sourceHandle}->${edge.target}`;
    if (seenEdges.has(sig)) {
      warn({ code: "DUPLICATE_EDGE", message: `Duplicate connection from ${source.data.label} to ${target.data.label}.`, edgeId: edge.id });
      continue;
    }
    seenEdges.add(sig);
    outgoing.get(source.id)!.push(target.id);
    incoming.get(target.id)!.push(source.id);
  }

  // ── Cycles (Kahn's algorithm) ───────────────────────────────────────────
  const indegree = new Map([...incoming].map(([id, ins]) => [id, ins.length]));
  const queue = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited++;
    for (const next of outgoing.get(id)!) {
      const d = indegree.get(next)! - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  const hasCycle = visited < byId.size;
  if (hasCycle) {
    for (const [id, d] of indegree) {
      if (d > 0) err({ code: "CYCLE", message: `${byId.get(id)!.data.label} is part of a loop. Workflows must not contain cycles.`, nodeId: id });
    }
  }

  // ── Connectivity ────────────────────────────────────────────────────────
  let outputCount = 0;
  for (const node of byId.values()) {
    const ins = incoming.get(node.id)!.length;
    const outs = outgoing.get(node.id)!.length;
    if (node.type === "output") {
      outputCount++;
      if (ins === 0) err({ code: "DISCONNECTED_OUTPUT", message: `${node.data.label} is not connected to anything.`, nodeId: node.id });
    } else if (node.type === "input") {
      if (outs === 0) warn({ code: "UNUSED_INPUT", message: `${node.data.label} is not used by any node.`, nodeId: node.id });
    } else if (ins === 0 && outs === 0) {
      warn({ code: "ISOLATED", message: `${node.data.label} is not connected.`, nodeId: node.id });
    }
    if (node.type === "condition" && outs === 0) {
      warn({ code: "UNUSED_BRANCHES", message: `${node.data.label} has no branches connected.`, nodeId: node.id });
    }
  }
  if (outputCount === 0) warn({ code: "NO_OUTPUT", message: "Add an Output node to collect results." });

  // ── Template references (must point upstream) ───────────────────────────
  if (!hasCycle) {
    const ancestors = (id: string) => {
      const seen = new Set<string>();
      const stack = [...incoming.get(id)!];
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        stack.push(...incoming.get(cur)!);
      }
      return seen;
    };

    for (const node of byId.values()) {
      if (node.type === "input") continue;
      const up = ancestors(node.id);
      for (const [field, value] of Object.entries(node.data.config)) {
        for (const ref of extractRefs(collectStrings(value).join("\n"))) {
          const inputNodeId = inputFieldOwner.get(ref.root);
          const refNodeId = inputNodeId ?? keyOwner.get(ref.root);
          if (!refNodeId) {
            err({ code: "UNKNOWN_REFERENCE", message: `${node.data.label}: ${ref.raw} doesn't match any input or node.`, nodeId: node.id, field });
            continue;
          }
          if (!up.has(refNodeId)) {
            err({
              code: "NOT_UPSTREAM",
              message: `${node.data.label}: ${ref.raw} must come from a node connected before it.`,
              nodeId: node.id,
              field,
            });
            continue;
          }
          const refNode = byId.get(refNodeId)!;
          const fields = NODE_SPECS[refNode.type].outputFields;
          if (!inputNodeId && ref.path.length > 0 && fields.length > 0 && !fields.includes(ref.path[0])) {
            err({
              code: "UNKNOWN_FIELD",
              message: `${node.data.label}: ${refNode.data.label} has no field "${ref.path[0]}" (available: ${fields.join(", ")}).`,
              nodeId: node.id,
              field,
            });
          }
        }
      }
    }
  }

  return { valid: !issues.some((i) => i.severity === "error"), issues };
}

/** Nodes that can be referenced from `nodeId` (its ancestors), for editor autocomplete. */
export function availableReferences(def: WorkflowDefinition, nodeId: string): { ref: string; label: string }[] {
  const incoming = new Map<string, string[]>(def.nodes.map((n) => [n.id, []]));
  for (const e of def.edges) incoming.get(e.target)?.push(e.source);
  const seen = new Set<string>();
  const stack = [...(incoming.get(nodeId) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(incoming.get(cur) ?? []));
  }
  const refs: { ref: string; label: string }[] = [];
  for (const n of def.nodes) {
    if (!seen.has(n.id)) continue;
    if (n.type === "input") {
      const name = (n.data.config as { fieldName?: unknown }).fieldName;
      if (typeof name === "string" && name) refs.push({ ref: `{{${name}}}`, label: `${n.data.label} input` });
    } else {
      for (const f of NODE_SPECS[n.type].outputFields) refs.push({ ref: `{{${n.data.key}.${f}}}`, label: `${n.data.label} → ${f}` });
    }
  }
  return refs;
}
