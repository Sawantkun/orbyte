import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as list from "@/app/api/integrations/route";
import * as item from "@/app/api/integrations/[id]/route";
import * as validate from "@/app/api/integrations/[id]/validate/route";
import * as usage from "@/app/api/usage/route";
import { db } from "@/lib/db";
import { createIntegration, resolveUserSecret, rotateIntegrationSecrets } from "@/server/integrations";
import { defaultProviders } from "@/server/providers";
import { getUsageSummary } from "@/server/usage";
import { json, params, request, signedInUser } from "../support/api";
import { createUser, resetDatabase } from "../support/db";

// Stand-in for OpenAI: /v1/models validates keys; /v1/responses echoes.
const GOOD = "sk-test-good-key-0123456789abcdef";
const BAD = "sk-test-bad-key-0123456789abcdefgh";
let server: http.Server;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${GOOD}`) return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `bad key ${auth}` } }));
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [] }));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// env is parsed once at import; point the module's OPENAI_BASE_URL at the mock.
beforeAll(async () => {
  const { env } = await import("@/lib/env");
  (env as { OPENAI_BASE_URL: string }).OPENAI_BASE_URL = process.env.OPENAI_BASE_URL!;
});

beforeEach(resetDatabase);

const connect = (cookie: string, body: unknown) => list.POST(request("/api/integrations", { method: "POST", cookie, body }), {} as never);

describe("integrations API", () => {
  it("validates, encrypts and never returns the secret", async () => {
    const { cookie, id: ownerId } = await signedInUser();
    const res = await connect(cookie, { provider: "openai", secret: GOOD });
    expect(res.status).toBe(201);
    const body = await res.text();
    expect(body).not.toContain(GOOD);
    expect(JSON.parse(body).data).toMatchObject({ provider: "openai", status: "ACTIVE", secretHint: "cdef", label: "Default" });

    const row = await db.integration.findFirstOrThrow({ where: { ownerId } });
    expect(row.encryptedSecret).not.toContain("good-key");
    expect(JSON.stringify(await json(await list.GET(request("/api/integrations", { cookie }), {} as never)))).not.toContain(GOOD);
    expect(await db.activityLog.count({ where: { ownerId, action: "integration.added" } })).toBe(1);
  });

  it("rejects bad formats, rejected keys, unsupported providers and duplicates", async () => {
    const { cookie } = await signedInUser();
    expect((await connect(cookie, { provider: "openai", secret: "not-a-key" })).status).toBe(400);
    const rejected = await connect(cookie, { provider: "openai", secret: BAD });
    expect(rejected.status).toBe(422);
    expect((await rejected.json()).error.code).toBe("KEY_REJECTED");
    expect((await connect(cookie, { provider: "anthropic", secret: "sk-ant-whatever-0123456789" })).status).toBe(400);
    expect((await connect(cookie, { provider: "openai", secret: GOOD })).status).toBe(201);
    expect((await connect(cookie, { provider: "openai", secret: GOOD })).status).toBe(409);
  });

  it("replaces, revalidates and deletes; other users get 404", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    const created = (await (await connect(alice.cookie, { provider: "openai", secret: GOOD })).json()).data;
    const p = params({ id: created.id });

    expect((await item.PATCH(request(`/api/integrations/${created.id}`, { method: "PATCH", cookie: bob.cookie, body: { secret: GOOD } }), p)).status).toBe(404);
    expect((await item.DELETE(request(`/api/integrations/${created.id}`, { method: "DELETE", cookie: bob.cookie }), p)).status).toBe(404);
    expect((await validate.POST(request(`/api/integrations/${created.id}/validate`, { method: "POST", cookie: bob.cookie }), p)).status).toBe(404);
    expect((await json(await list.GET(request("/api/integrations", { cookie: bob.cookie }), {} as never))).data).toEqual([]);

    const replacedBad = await item.PATCH(request(`/api/integrations/${created.id}`, { method: "PATCH", cookie: alice.cookie, body: { secret: BAD } }), p);
    expect(replacedBad.status).toBe(422);
    const revalidated = await json(await validate.POST(request(`/api/integrations/${created.id}/validate`, { method: "POST", cookie: alice.cookie }), p));
    expect(revalidated.data.status).toBe("ACTIVE");

    expect((await item.DELETE(request(`/api/integrations/${created.id}`, { method: "DELETE", cookie: alice.cookie }), p)).status).toBe(204);
    expect(await db.integration.count()).toBe(0);
  });
});

describe("credential resolution", () => {
  it("prefers the user's key, redacts it, and marks it invalid when the provider rejects it", async () => {
    const { cookie, id: ownerId } = await signedInUser();
    await connect(cookie, { provider: "openai", secret: GOOD });
    const resolved = await defaultProviders.text("openai", ownerId);
    expect(resolved.source).toBe("user");
    expect(resolved.secrets).toEqual([GOOD]);
    await expect(resolved.provider.generateText({ model: "gpt-6.2-sol", prompt: "hi", maxOutputTokens: 5, signal: new AbortController().signal })).resolves.toMatchObject({ text: "ok" });

    // Key revoked at the provider after it was saved.
    const row = await db.integration.findFirstOrThrow({ where: { ownerId } });
    const { sealSecret } = await import("@/server/crypto/secrets");
    await db.integration.update({ where: { id: row.id }, data: sealSecret(BAD, { ownerId, provider: "openai" }) });
    const again = await defaultProviders.text("openai", ownerId);
    await expect(again.provider.generateText({ model: "gpt-6.2-sol", prompt: "hi", maxOutputTokens: 5, signal: new AbortController().signal })).rejects.toMatchObject({
      code: "PROVIDER_AUTH",
      message: "OpenAI rejected your API key. Update it in Integrations.",
    });
    expect((await db.integration.findFirstOrThrow({ where: { ownerId } })).status).toBe("INVALID");
  });

  it("fails clearly with no user key and no platform key", async () => {
    const user = await createUser();
    await expect(defaultProviders.text("openai", user.id)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    expect(await resolveUserSecret(user.id, "openai")).toBeNull();
  });

  it("rotation re-encrypts rows on an old key version", async () => {
    const user = await createUser();
    await createIntegration(user.id, { provider: "openai", secret: GOOD }, async () => "ACTIVE");
    // Pretend the row was written under version 0 with the same key material (previous key present).
    const { env } = await import("@/lib/env");
    const e = env as { ENCRYPTION_KEY_VERSION: number; ENCRYPTION_KEY_PREVIOUS?: string };
    const prevVersion = e.ENCRYPTION_KEY_VERSION;
    e.ENCRYPTION_KEY_PREVIOUS = process.env.ENCRYPTION_KEY;
    e.ENCRYPTION_KEY_VERSION = prevVersion + 1;
    try {
      await db.integration.updateMany({ where: { ownerId: user.id }, data: { keyVersion: prevVersion } });
      expect(await rotateIntegrationSecrets()).toEqual({ rotated: 1, failed: 0 });
      const row = await db.integration.findFirstOrThrow({ where: { ownerId: user.id } });
      expect(row.keyVersion).toBe(prevVersion + 1);
      expect(await resolveUserSecret(user.id, "openai")).toMatchObject({ secret: GOOD });
    } finally {
      e.ENCRYPTION_KEY_VERSION = prevVersion;
      e.ENCRYPTION_KEY_PREVIOUS = undefined;
    }
  });
});

describe("usage analytics", () => {
  it("aggregates only the caller's usage within the range, separating unpriced requests", async () => {
    const { cookie, id: ownerId } = await signedInUser();
    const other = await createUser("Other");
    const wf = await db.workflow.create({ data: { ownerId, name: "Launch copy", definition: {} } });
    const v = await db.workflowVersion.create({ data: { workflowId: wf.id, version: 1, definition: {}, createdById: ownerId } });
    const ex = await db.workflowExecution.create({ data: { ownerId, workflowId: wf.id, workflowVersionId: v.id, status: "COMPLETED" } });
    await db.workflowExecution.create({ data: { ownerId, workflowId: wf.id, workflowVersionId: v.id, status: "FAILED" } });
    const now = new Date();
    await db.usageRecord.createMany({
      data: [
        { ownerId, provider: "openai", model: "gpt-6.2-sol", executionId: ex.id, inputTokens: 1000, outputTokens: 500, costUsd: "0.007" },
        { ownerId, provider: "openai", model: "gpt-image-2.6-flare", executionId: ex.id, inputTokens: 10, outputTokens: 4000, imageCount: 2, costUsd: "0.12005" },
        { ownerId, provider: "openai", model: "mystery-model", inputTokens: 5, outputTokens: 5, costUsd: null },
        { ownerId, provider: "openai", model: "gpt-6.2-sol", inputTokens: 999, outputTokens: 999, costUsd: "9", createdAt: new Date(now.getTime() - 40 * 86_400_000) },
        { ownerId: other.id, provider: "openai", model: "gpt-6.2-sol", inputTokens: 1, outputTokens: 1, costUsd: "5" },
      ],
    });

    const s = await getUsageSummary(ownerId, 30, now);
    expect(s.totals).toEqual({ requests: 3, inputTokens: 1015, outputTokens: 4505, images: 2, costUsd: 0.12705, unpricedRequests: 1, executions: 2, failedExecutions: 1 });
    expect(s.daily).toHaveLength(30);
    expect(s.daily.at(-1)!.costUsd).toBeCloseTo(0.12705, 6);
    expect(s.byModel.map((m) => [m.model, m.costUsd])).toEqual([
      ["gpt-image-2.6-flare", 0.12005],
      ["gpt-6.2-sol", 0.007],
      ["mystery-model", null],
    ]);
    expect(s.byWorkflow).toEqual([{ workflowId: wf.id, name: "Launch copy", executions: 2, tokens: 5510, costUsd: 0.12705 }]);

    expect((await getUsageSummary(ownerId, 90, now)).totals.requests).toBe(4);
    const api = await json(await usage.GET(request("/api/usage?days=7", { cookie }), {} as never));
    expect(api.data.days).toBe(7);
    expect((await usage.GET(request("/api/usage?days=5", { cookie }), {} as never)).status).toBe(400);
  });
});
