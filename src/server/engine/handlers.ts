import { findModel } from "@/config/ai-models";
import { OperationError, evaluateCondition, runTransform } from "@/lib/engine/operations";
import { resolveText, resolveValue, type Scope } from "@/lib/engine/resolve";
import type { NodeConfigMap, NodeType, WorkflowNode } from "@/lib/workflow/schema";
import { EMAIL, MAX_RECIPIENTS, splitRecipients } from "@/lib/workflow/validate";
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

/** Loads an image asset owned by the run's owner, downscaled for model input. */
export type LoadImage = (assetId: string) => Promise<{ data: Buffer; mimeType: string; name: string }>;

/** Sends email through the owner's connected Gmail. */
/** Loads an asset owned by the run's owner as an email attachment (size-limited). */
export type LoadAttachment = (assetId: string) => Promise<{ filename: string; content: Buffer; contentType: string }>;

export type SendMail = (
  email: { to: string[]; subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer; contentType: string }[] },
  signal: AbortSignal,
) => Promise<{ from: string; messageId: string; accepted: string[]; rejected: string[] }>;

export type HandlerContext = {
  ownerId: string;
  loadImage: LoadImage;
  loadAttachment: LoadAttachment;
  sendMail: SendMail;
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

const SOURCE_LOG = {
  user: "Using your connected API key",
  platform: "Using the workspace API key",
  "local-cli": "Using the local Claude CLI on this machine (your Claude subscription)",
} as const;

const IMAGE_SIZES = { "1:1": "1024x1024", "16:9": "1536x1024", "4:3": "1536x1024", "9:16": "1024x1536", "3:4": "1024x1536" } as const;

/** Asset references produced by AI Image nodes: [{ assetId, ... }]. */
function assetRefs(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((v) => (v && typeof v === "object" && typeof (v as { assetId?: unknown }).assetId === "string" ? [(v as { assetId: string }).assetId] : []));
}

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Asset ids from an attachments value: an id, a list of ids, or generated-file references. */
function attachmentRefs(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const ids = list.flatMap((v) => (typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : assetRefs(v)));
  return [...new Set(ids)];
}

/** Plain-text fallback for HTML email. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

    // Optional image: an image input (asset id) or a generated image ([{ assetId }]).
    let images: { data: Buffer; mimeType: string }[] | undefined;
    let imageName: string | undefined;
    if (c.image.trim()) {
      const ref = value(ctx, c.image, "Image");
      const id = typeof ref === "string" ? ref.trim() : assetRefs(ref)[0];
      if (!id) throw new NodeError("INVALID_DATA", "Image: no image was provided", false);
      const img = await ctx.loadImage(id);
      images = [{ data: img.data, mimeType: img.mimeType }];
      imageName = img.name;
      ctx.log("info", `Attached image "${img.name}"`, { bytes: img.data.length });
    }

    const { provider, secrets, source } = await ctx.providers.text(c.provider, ctx.ownerId);
    ctx.addSecrets(secrets);
    if (source) ctx.log("info", SOURCE_LOG[source]);
    ctx.log("info", `Calling ${c.provider} ${c.model}`, { promptChars: prompt.length, maxOutputTokens: c.maxOutputTokens });
    const result = await provider.generateText({
      model: c.model,
      system: system || undefined,
      prompt,
      maxOutputTokens: c.maxOutputTokens,
      temperature: model.supportsTemperature ? c.temperature : undefined,
      images,
      signal: ctx.signal,
    });
    if (result.truncated) ctx.log("warn", "Output stopped early (token limit reached)");
    ctx.log("info", "Received response", { outputChars: result.text.length, ...result.usage });
    return {
      input: { model: c.model, system, prompt, ...(imageName ? { image: imageName } : {}) },
      output: { text: result.text },
      usage: { provider: c.provider, model: c.model, ...result.usage },
    };
  },

  async ai_image(c, ctx) {
    const prompt = text(ctx, c.prompt, "Prompt");
    if (!prompt.trim()) throw new NodeError("EMPTY_PROMPT", "The prompt resolved to empty text", false);
    const model = findModel(c.provider, c.model);
    if (!model || model.capability !== "image") throw new NodeError("UNKNOWN_MODEL", `Unknown model "${c.model}"`, false);
    const { provider, secrets, source } = await ctx.providers.image(c.provider, ctx.ownerId);
    ctx.addSecrets(secrets);
    if (source) ctx.log("info", SOURCE_LOG[source]);
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

  async send_email(c, ctx) {
    const rawTo = text(ctx, c.to, "To");
    const subject = text(ctx, c.subject, "Subject").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
    const body = text(ctx, c.body, "Body");
    const to = splitRecipients(rawTo);
    if (!to.length) throw new NodeError("INVALID_DATA", "To: no recipient", false);
    const bad = to.find((r) => !EMAIL.test(r));
    if (bad) throw new NodeError("INVALID_DATA", `To: "${bad.slice(0, 100)}" isn't a valid email address`, false);
    if (to.length > MAX_RECIPIENTS) throw new NodeError("INVALID_DATA", `To: at most ${MAX_RECIPIENTS} recipients`, false);
    if (!subject) throw new NodeError("INVALID_DATA", "Subject is empty", false);
    if (!body.trim()) throw new NodeError("INVALID_DATA", "Body is empty", false);

    // Attachments: asset ids or references to generated files.
    const ids = c.attachments.trim() ? attachmentRefs(value(ctx, c.attachments, "Attachments")) : [];
    if (c.attachments.trim() && !ids.length) throw new NodeError("INVALID_DATA", "Attachments: no files were provided", false);
    if (ids.length > MAX_ATTACHMENTS) throw new NodeError("INVALID_DATA", `Attachments: at most ${MAX_ATTACHMENTS} files`, false);
    const files = [];
    for (const assetId of ids) files.push(await ctx.loadAttachment(assetId));
    const total = files.reduce((n, f) => n + f.content.length, 0);
    if (total > MAX_ATTACHMENT_BYTES) throw new NodeError("INVALID_DATA", `Attachments: ${Math.ceil(total / 1048576)} MB is over Gmail's ${MAX_ATTACHMENT_BYTES / 1048576} MB limit`, false);

    const html = c.format === "html" ? body : undefined;
    const plain = html ? htmlToText(html) : body;
    const attachments = files.map((f) => ({ name: f.filename, bytes: f.content.length }));
    const input = { to, subject, body, format: c.format, attachments, preview: c.preview };

    if (c.preview) {
      ctx.log("info", `Preview only: email to ${to.join(", ")} was not sent (turn off Preview to send)`, attachments.length ? { attachments: attachments.length } : undefined);
      return { input, output: { sent: false, to, subject, body, attachments, messageId: null } };
    }
    const sent = await ctx.sendMail({ to, subject, text: plain, ...(html ? { html } : {}), ...(files.length ? { attachments: files } : {}) }, ctx.signal);
    ctx.log("info", `Sent from ${sent.from} to ${sent.accepted.join(", ") || to.join(", ")}`, { messageId: sent.messageId });
    if (sent.rejected.length) ctx.log("warn", `Gmail rejected: ${sent.rejected.join(", ")}`);
    return { input, output: { sent: true, to, subject, body, attachments, messageId: sent.messageId } };
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
