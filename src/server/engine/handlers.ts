import { findModel } from "@/config/ai-models";
import { OperationError, evaluateCondition, runTransform } from "@/lib/engine/operations";
import { resolveText, resolveValue, type Scope } from "@/lib/engine/resolve";
import type { NodeConfigMap, NodeType, WorkflowNode } from "@/lib/workflow/schema";
import type { ProviderResolver } from "../providers/types";
import { NodeError } from "./errors";
import { safeRequest, type LookupFn } from "./safe-http";

export type LogLevel = "info" | "warn" | "error";

/** Saves generated content as an asset with this node's provenance attached. */
export type SaveAsset = (input: {
  name: string;
  buffer: Buffer;
  mimeType: string;
  extension: string;
  collectionId?: string | null;
  originalPrompt?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  metadata?: Record<string, unknown>;
}) => Promise<{ id: string; name: string; mimeType: string }>;

/** Moves existing assets (from this execution) into a collection / merges metadata. */
export type AnnotateAssets = (assetIds: string[], patch: { collectionId?: string | null; metadata?: Record<string, unknown> }) => Promise<number>;

export type HandlerContext = {
  ownerId: string;
  saveAsset: SaveAsset;
  annotateAssets: AnnotateAssets;
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
  usage?: { provider: string; model: string; inputTokens: number; outputTokens: number; imageCount?: number };
};

const IMAGE_SIZES = { "1:1": "1024x1024", "16:9": "1536x1024", "4:3": "1536x1024", "9:16": "1024x1536", "3:4": "1024x1536" } as const;

/** Asset references produced by AI Image nodes: [{ assetId, ... }]. */
function assetRefs(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((v) => (v && typeof v === "object" && typeof (v as { assetId?: unknown }).assetId === "string" ? [(v as { assetId: string }).assetId] : []));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "output";

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

  async ai_image(c, ctx) {
    const prompt = text(ctx, c.prompt, "Prompt");
    if (!prompt.trim()) throw new NodeError("EMPTY_PROMPT", "The prompt resolved to empty text", false);
    const model = findModel(c.provider, c.model);
    if (!model || model.capability !== "image") throw new NodeError("UNKNOWN_MODEL", `Unknown model "${c.model}"`, false);
    const { provider, secrets } = await ctx.providers.image(c.provider, ctx.ownerId);
    ctx.addSecrets(secrets);
    const size = IMAGE_SIZES[c.aspectRatio];
    ctx.log("info", `Generating ${c.count} image(s) with ${c.provider} ${c.model}`, { size, quality: c.quality });
    const result = await provider.generateImages({ model: c.model, prompt, size, quality: c.quality, count: c.count, signal: ctx.signal });

    const images = [];
    for (const [i, img] of result.images.entries()) {
      const saved = await ctx.saveAsset({
        name: `${ctx.node.data.label} ${i + 1}.png`,
        buffer: img.data,
        mimeType: img.mimeType,
        extension: "png",
        collectionId: c.collectionId,
        originalPrompt: prompt,
        aiProvider: c.provider,
        aiModel: c.model,
        metadata: { size, quality: c.quality, aspectRatio: c.aspectRatio },
      });
      images.push({ assetId: saved.id, name: saved.name, mimeType: saved.mimeType });
    }
    ctx.log("info", `Saved ${images.length} image(s) to the asset library`);
    return {
      input: { model: c.model, prompt, size, quality: c.quality, count: c.count },
      output: { images },
      usage: { provider: c.provider, model: c.model, ...result.usage, imageCount: images.length },
    };
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
    const metadata = Object.fromEntries(c.metadata.filter((m) => m.key.trim()).map((m) => [m.key.trim(), text(ctx, m.value, `Metadata ${m.key}`)]));
    const output: Record<string, unknown> = { name: c.name, format: c.format, value: v, metadata };

    if (c.saveToLibrary) {
      const refs = c.format === "file" ? assetRefs(v) : [];
      if (refs.length) {
        // Files generated upstream are already assets: file them and attach metadata.
        const n = await ctx.annotateAssets(refs, { collectionId: c.collectionId, metadata: { output: c.name, ...metadata } });
        ctx.log("info", `Organised ${n} generated file(s) in the library`);
        output.assetIds = refs;
      } else if (v === null || v === undefined || v === "") {
        ctx.log("warn", "Nothing to save: the value is empty");
      } else {
        const isJson = c.format === "json" || (typeof v !== "string" && c.format !== "text");
        const body = isJson ? JSON.stringify(v, null, 2) : typeof v === "string" ? v : JSON.stringify(v);
        const saved = await ctx.saveAsset({
          name: `${slug(c.name)}.${isJson ? "json" : "txt"}`,
          buffer: Buffer.from(body, "utf8"),
          mimeType: isJson ? "application/json" : "text/plain",
          extension: isJson ? "json" : "txt",
          collectionId: c.collectionId,
          metadata: { output: c.name, ...metadata },
        });
        ctx.log("info", `Saved "${saved.name}" to the asset library`);
        output.assetIds = [saved.id];
      }
    }
    return { input: {}, output };
  },
};

export async function runHandler(type: NodeType, config: unknown, ctx: HandlerContext): Promise<HandlerResult> {
  return (HANDLERS[type] as Handler<NodeType>)(config as NodeConfigMap[NodeType], ctx);
}
