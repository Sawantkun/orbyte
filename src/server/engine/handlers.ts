import { findModel } from "@/config/ai-models";
import { OperationError, evaluateCondition, runTransform } from "@/lib/engine/operations";
import { resolveText, resolveValue, type Scope } from "@/lib/engine/resolve";
import type { NodeConfigMap, NodeType, WorkflowNode } from "@/lib/workflow/schema";
import type { ProviderResolver } from "../providers/types";
import { NodeError } from "./errors";
import { safeRequest, type LookupFn } from "./safe-http";

export type LogLevel = "info" | "warn" | "error";

export type HandlerContext = {
  ownerId: string;
  node: WorkflowNode;
  scope: Scope;
  signal: AbortSignal;
  timeoutMs: number;
  providers: ProviderResolver;
  log: (level: LogLevel, message: string, data?: Record<string, unknown>) => void;
  /** Register secret values (e.g. API keys) that must be redacted from anything persisted. */
  addSecrets: (secrets: string[]) => void;
  httpLookup?: LookupFn;
};

export type HandlerResult = {
  /** Resolved inputs, recorded for inspection. */
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  usage?: { provider: string; model: string; inputTokens: number; outputTokens: number };
};

type Handler<T extends NodeType> = (config: NodeConfigMap[T], ctx: HandlerContext) => Promise<HandlerResult>;

function text(ctx: HandlerContext, template: string, label: string) {
  const r = resolveText(template, ctx.scope);
  if (r.missing.length) ctx.log("warn", `${label}: no value for ${r.missing.join(", ")}`);
  return r.value;
}

function value(ctx: HandlerContext, template: string, label: string) {
  const r = resolveValue(template, ctx.scope);
  if (r.missing.length) ctx.log("warn", `${label}: no value for ${r.missing.join(", ")}`);
  return r.value;
}

const wrapOp = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    if (e instanceof OperationError) throw new NodeError("INVALID_DATA", e.message, false);
    throw e;
  }
};

const HANDLERS: { [K in NodeType]: Handler<K> } = {
  async input(c, ctx) {
    const v = ctx.scope.inputs[c.fieldName] ?? null;
    return { input: {}, output: { value: v } };
  },

  async prompt_template(c, ctx) {
    const filled = text(ctx, c.template, "Template");
    return { input: { template: c.template }, output: { text: filled } };
  },

  async ai_text(c, ctx) {
    const system = text(ctx, c.systemPrompt, "System instructions");
    const prompt = text(ctx, c.prompt, "Prompt");
    if (!prompt.trim()) throw new NodeError("EMPTY_PROMPT", "The prompt resolved to empty text", false);
    const model = findModel(c.provider, c.model);
    if (!model || model.capability !== "text") throw new NodeError("UNKNOWN_MODEL", `Unknown model "${c.model}"`, false);

    const { provider, secrets } = await ctx.providers.text(c.provider, ctx.ownerId);
    ctx.addSecrets(secrets);
    ctx.log("info", `Calling ${c.provider} ${c.model}`, { promptChars: prompt.length, maxOutputTokens: c.maxOutputTokens });
    const result = await provider.generateText({
      model: c.model,
      system: system || undefined,
      prompt,
      maxOutputTokens: c.maxOutputTokens,
      temperature: model.supportsTemperature ? c.temperature : undefined,
      signal: ctx.signal,
    });
    if (result.truncated) ctx.log("warn", "Output stopped early (token limit reached)");
    ctx.log("info", "Received response", { outputChars: result.text.length, ...result.usage });
    return {
      input: { model: c.model, system, prompt },
      output: { text: result.text },
      usage: { provider: c.provider, model: c.model, ...result.usage },
    };
  },

  async ai_image() {
    throw new NodeError("NOT_AVAILABLE", "Image generation runs once asset storage ships (Milestone 4).", false);
  },

  async condition(c, ctx) {
    const left = value(ctx, c.left, "Value to check");
    const right = c.operator === "exists" ? null : value(ctx, c.right, "Compare with");
    const result = wrapOp(() => evaluateCondition(c.operator, left, right));
    ctx.log("info", `Condition is ${result}`);
    return { input: { left, operator: c.operator, right }, output: { result } };
  },

  async transform(c, ctx) {
    const input = c.operation === "template" ? text(ctx, c.input, "Input") : value(ctx, c.input, "Input");
    const result = wrapOp(() => runTransform(c.operation, input, c.argument, c.replacement));
    return { input: { operation: c.operation, input, argument: c.argument }, output: { result } };
  },

  async http_request(c, ctx) {
    const url = text(ctx, c.url, "URL").trim();
    const headers = Object.fromEntries(c.headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), text(ctx, h.value, `Header ${h.key}`)]));
    const body = c.method === "GET" || c.method === "DELETE" ? undefined : text(ctx, c.body, "Body");
    if (body && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = /^\s*[[{]/.test(body) ? "application/json" : "text/plain";
    }
    ctx.log("info", `${c.method} ${url}`);
    const res = await safeRequest({ method: c.method, url, headers, body, timeoutMs: c.timeoutMs, signal: ctx.signal, lookup: ctx.httpLookup });
    ctx.log(res.status >= 400 ? "warn" : "info", `HTTP ${res.status}`, { bytes: res.body.length });
    if (res.status >= 400) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new NodeError("HTTP_ERROR", `Request failed with HTTP ${res.status}`, retryable);
    }
    let parsed: unknown = res.body;
    if (c.responseType === "json" && res.body) {
      try {
        parsed = JSON.parse(res.body);
      } catch {
        throw new NodeError("INVALID_DATA", "Response was not valid JSON (set the response type to Text to accept it)", false);
      }
    }
    return { input: { method: c.method, url, headers, body }, output: { status: res.status, body: parsed, headers: res.headers } };
  },

  async output(c, ctx) {
    let v = value(ctx, c.value, "Value");
    if (c.format === "json" && typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        throw new NodeError("INVALID_DATA", `Output "${c.name}" is not valid JSON`, false);
      }
    }
    if (c.saveToLibrary) ctx.log("warn", "Saving outputs to the asset library arrives in Milestone 4; the value is kept on this execution.");
    const metadata = Object.fromEntries(c.metadata.filter((m) => m.key.trim()).map((m) => [m.key.trim(), text(ctx, m.value, `Metadata ${m.key}`)]));
    return { input: {}, output: { name: c.name, format: c.format, value: v, metadata } };
  },
};

export async function runHandler(type: NodeType, config: unknown, ctx: HandlerContext): Promise<HandlerResult> {
  return (HANDLERS[type] as Handler<NodeType>)(config as NodeConfigMap[NodeType], ctx);
}
