import { NodeError } from "../engine/errors";
import type { ImageGenerationRequest, ImageGenerationResult, ImageProvider, TextGenerationRequest, TextGenerationResult, TextProvider } from "./types";

/**
 * OpenAI adapter using the Responses API (POST /v1/responses), which OpenAI
 * recommends for new projects. Plain fetch — no SDK dependency.
 */
type ResponsesPayload = {
  status?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string; code?: string } | null;
};

function throwForStatus(res: Response, payload: { error?: { message?: string; code?: string } | null } | null): never {
  const msg = payload?.error?.message?.slice(0, 300) ?? `HTTP ${res.status}`;
  const code = payload?.error?.code;
  if (res.status === 401 || res.status === 403) throw new NodeError("PROVIDER_AUTH", "OpenAI rejected the API key. Check the configured credential.", false);
  if (res.status === 429 && code === "insufficient_quota") throw new NodeError("PROVIDER_QUOTA", "OpenAI quota exceeded for this API key.", false);
  if (res.status === 429) throw new NodeError("PROVIDER_RATE_LIMIT", "OpenAI rate limit reached.", true, retryAfterMs(res));
  if (res.status >= 500) throw new NodeError("PROVIDER_ERROR", `OpenAI error (${res.status}).`, true, retryAfterMs(res));
  throw new NodeError("PROVIDER_REJECTED", `OpenAI rejected the request: ${msg}`, false);
}

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const s = Number(h);
  return Number.isFinite(s) ? Math.min(s * 1000, 60_000) : undefined;
}

export class OpenAIProvider implements TextProvider, ImageProvider {
  readonly id = "openai";
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com",
  ) {}

  async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      input: req.images?.length
        ? [
            {
              role: "user",
              content: [
                ...req.images.map((img) => ({ type: "input_image", image_url: `data:${img.mimeType};base64,${img.data.toString("base64")}` })),
                { type: "input_text", text: req.prompt },
              ],
            },
          ]
        : req.prompt,
      max_output_tokens: req.maxOutputTokens,
      store: false,
    };
    if (req.system) body.instructions = req.system;
    if (req.temperature !== undefined) body.temperature = req.temperature;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e) {
      if (req.signal.aborted) throw new NodeError("CANCELLED", "Cancelled", false);
      throw new NodeError("PROVIDER_UNREACHABLE", `Couldn't reach OpenAI (${(e as Error).name})`, true);
    }

    const payload = (await res.json().catch(() => null)) as ResponsesPayload | null;
    if (!res.ok) throwForStatus(res, payload);
    if (!payload) throw new NodeError("PROVIDER_ERROR", "OpenAI returned an unreadable response.", true);
    if (payload.status === "failed") throw new NodeError("PROVIDER_ERROR", payload.error?.message?.slice(0, 300) ?? "OpenAI reported a failure.", true);

    const text = (payload.output ?? [])
      .filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("");

    return {
      text,
      usage: { inputTokens: payload.usage?.input_tokens ?? 0, outputTokens: payload.usage?.output_tokens ?? 0 },
      truncated: payload.status === "incomplete",
    };
  }

  /** Image API: POST /v1/images/generations — returns base64 image data. */
  async generateImages(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/images/generations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: req.model, prompt: req.prompt, n: req.count, size: req.size, quality: req.quality, output_format: "png" }),
        signal: req.signal,
      });
    } catch (e) {
      if (req.signal.aborted) throw new NodeError("CANCELLED", "Cancelled", false);
      throw new NodeError("PROVIDER_UNREACHABLE", `Couldn't reach OpenAI (${(e as Error).name})`, true);
    }
    const payload = (await res.json().catch(() => null)) as {
      data?: { b64_json?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { message?: string; code?: string };
    } | null;
    if (!res.ok) throwForStatus(res, payload);
    const images = (payload?.data ?? [])
      .map((d) => d.b64_json)
      .filter((b): b is string => typeof b === "string" && b.length > 0)
      .map((b) => ({ data: Buffer.from(b, "base64"), mimeType: "image/png" }));
    if (images.length === 0) throw new NodeError("PROVIDER_ERROR", "OpenAI returned no images.", true);
    return { images, usage: { inputTokens: payload?.usage?.input_tokens ?? 0, outputTokens: payload?.usage?.output_tokens ?? 0 } };
  }
}
