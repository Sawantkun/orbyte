import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAIProvider } from "@/server/providers/openai";

let server: http.Server;
let base = "";
let next: { status: number; body: unknown; headers?: Record<string, string> } = { status: 200, body: {} };
let last: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> } | null = null;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      last = { headers: req.headers, body: JSON.parse(raw) };
      res.writeHead(next.status, { "content-type": "application/json", ...next.headers }).end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const provider = () => new OpenAIProvider("sk-test-key", base);
const call = (extra: Partial<Parameters<OpenAIProvider["generateText"]>[0]> = {}) =>
  provider().generateText({ model: "gpt-6.2-sol", prompt: "Hi", maxOutputTokens: 100, signal: new AbortController().signal, ...extra });

describe("OpenAIProvider (Responses API)", () => {
  it("sends the expected request and parses output text + usage", async () => {
    next = {
      status: 200,
      body: {
        status: "completed",
        output: [
          { type: "reasoning", summary: [] },
          { type: "message", content: [{ type: "output_text", text: "Hello " }, { type: "output_text", text: "world" }] },
        ],
        usage: { input_tokens: 12, output_tokens: 3 },
      },
    };
    const res = await call({ system: "Be nice" });
    expect(res).toEqual({ text: "Hello world", usage: { inputTokens: 12, outputTokens: 3 }, truncated: false });
    expect(last!.headers.authorization).toBe("Bearer sk-test-key");
    expect(last!.body).toEqual({ model: "gpt-6.2-sol", input: "Hi", max_output_tokens: 100, store: false, instructions: "Be nice" });
  });

  it("only sends temperature when provided", async () => {
    next = { status: 200, body: { status: "completed", output: [], usage: {} } };
    await call({ temperature: 0.2 });
    expect(last!.body.temperature).toBe(0.2);
  });

  it("flags incomplete responses as truncated", async () => {
    next = { status: 200, body: { status: "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: "part" }] }], usage: { input_tokens: 1, output_tokens: 100 } } };
    expect((await call()).truncated).toBe(true);
  });

  it.each([
    [401, {}, undefined, "PROVIDER_AUTH", false],
    [429, { error: { code: "insufficient_quota" } }, undefined, "PROVIDER_QUOTA", false],
    [429, { error: { code: "rate_limit_exceeded" } }, { "retry-after": "2" }, "PROVIDER_RATE_LIMIT", true],
    [503, {}, undefined, "PROVIDER_ERROR", true],
    [400, { error: { message: "Unsupported parameter: temperature" } }, undefined, "PROVIDER_REJECTED", false],
  ] as const)("maps HTTP %i to %s", async (status, body, headers, code, retryable) => {
    next = { status, body, headers };
    await expect(call()).rejects.toMatchObject({ code, retryable });
  });

  it("does not leak the API key in error messages", async () => {
    next = { status: 401, body: { error: { message: "Incorrect API key provided: sk-test-key" } } };
    await expect(call()).rejects.toSatisfy((e: Error) => !e.message.includes("sk-test-key"));
  });

  it("generates images via the Image API and decodes base64", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    next = { status: 200, body: { data: [{ b64_json: png.toString("base64") }, { b64_json: png.toString("base64") }], usage: { input_tokens: 9, output_tokens: 300 } } };
    const res = await provider().generateImages({ model: "gpt-image-2.6-flare", prompt: "cat", size: "1024x1536", quality: "low", count: 2, signal: new AbortController().signal });
    expect(res.images).toHaveLength(2);
    expect(res.images[0]).toEqual({ data: png, mimeType: "image/png" });
    expect(res.usage).toEqual({ inputTokens: 9, outputTokens: 300 });
    expect(last!.body).toEqual({ model: "gpt-image-2.6-flare", prompt: "cat", n: 2, size: "1024x1536", quality: "low", output_format: "png" });
    next = { status: 200, body: { data: [] } };
    await expect(provider().generateImages({ model: "m", prompt: "x", size: "1024x1024", quality: "auto", count: 1, signal: new AbortController().signal })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("maps network failures to a retryable error", async () => {
    await expect(new OpenAIProvider("k", "http://127.0.0.1:1").generateText({ model: "m", prompt: "x", maxOutputTokens: 1, signal: new AbortController().signal })).rejects.toMatchObject({ code: "PROVIDER_UNREACHABLE", retryable: true });
  });
});
