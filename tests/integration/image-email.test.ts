import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { NODE_SPECS } from "@/lib/workflow/registry";
import { deriveInputSchema, type NodeType, type WorkflowDefinition, type WorkflowNode } from "@/lib/workflow/schema";
import { coerceInputs } from "@/lib/engine/inputs";
import { createAsset } from "@/server/assets/service";
import { runExecution } from "@/server/engine/executor";
import { startExecution } from "@/server/executions";
import { createIntegration, resolveGmail } from "@/server/integrations";
import type { Mailer } from "@/server/mail";
import type { ProviderResolver, TextGenerationRequest } from "@/server/providers/types";
import { createUser, resetDatabase } from "../support/db";
import { pngBytes } from "../support/files";

const n = (id: string, type: NodeType, key: string, config: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: { key, label: id, config: { ...NODE_SPECS[type].defaultConfig(), ...config } },
});
const e = (source: string, target: string) => ({ id: `${source}-${target}`, source, target, sourceHandle: "out", targetHandle: "in" });
const APP_PASSWORD = "abcdefghijklmnop";

function fakes() {
  const textCalls: TextGenerationRequest[] = [];
  const sent: { user: string; to: string[]; subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer; contentType: string }[] }[] = [];
  const providers: ProviderResolver = {
    async text() {
      return {
        secrets: [],
        source: "local-cli",
        provider: {
          id: "claude-cli",
          async generateText(r) {
            textCalls.push(r);
            const text = r.images?.length ? `A ${r.images[0].mimeType} photo of a purple square` : `Hi! ${r.prompt.slice(-30)}`;
            return { text, usage: { inputTokens: 100, outputTokens: 10 }, truncated: false };
          },
        },
      };
    },
    async image() {
      throw new Error("unused");
    },
  };
  const mailer: Mailer = {
    async verify() {
      return "ok";
    },
    async send(cred, email) {
      sent.push({ user: cred.user, ...email });
      return { messageId: "<m1@gmail>", accepted: email.to, rejected: [] };
    },
  };
  return { providers, mailer, textCalls, sent, deps: { providers, mailer, nodeConcurrency: 2, nodeTimeoutMs: 10_000, maxAttempts: 1, cancelPollMs: 50 } };
}

function definition(email: Record<string, unknown> = {}): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      n("in", "input", "input_1", { fieldName: "photo", fieldType: "image" }),
      n("see", "ai_text", "text_1", { provider: "claude-cli", model: "claude-haiku-5-5", prompt: "Explain this image", image: "{{photo}}" }),
      n("draft", "ai_text", "text_2", { provider: "claude-cli", model: "claude-haiku-5-5", prompt: "Write an email about: {{text_1.text}}" }),
      n("mail", "send_email", "email_1", { to: "friend@example.com", subject: "About your photo\r\nBcc: evil@x.com", body: "{{text_2.text}}", ...email }),
    ],
    edges: [e("in", "see"), e("see", "draft"), e("draft", "mail")],
  };
}

async function setup(def: WorkflowDefinition, owner?: { id: string }) {
  const user = owner ?? (await createUser());
  const wf = await db.workflow.create({ data: { ownerId: user.id, name: "Photo mail", definition: def as unknown as Prisma.InputJsonValue, latestVersion: 1 } });
  await db.workflowVersion.create({ data: { workflowId: wf.id, version: 1, createdById: user.id, definition: { ...def, inputSchema: deriveInputSchema(def) } as unknown as Prisma.InputJsonValue } });
  const photo = await createAsset(user.id, { name: "square.png", buffer: await pngBytes(2400, 1800), mimeType: "image/png", extension: "png", kind: "IMAGE", source: "UPLOAD", tags: [] });
  const run = (inputs: Record<string, unknown>) => startExecution(user.id, wf.id, { inputs }, async () => {}).then((r) => r.execution.id);
  return { user, photo, run };
}

const nodes = (executionId: string) => db.nodeExecution.findMany({ where: { executionId }, orderBy: { createdAt: "asc" } });

beforeEach(resetDatabase);

describe("image → Claude → email", () => {
  it("passes the uploaded image (downscaled) to the model, then previews the email without sending", async () => {
    const f = fakes();
    const { run, photo } = await setup(definition());
    const id = await run({ photo: photo.id });
    expect(await runExecution(id, f.deps)).toBe("COMPLETED");

    const img = f.textCalls[0].images![0];
    expect(img.mimeType).toBe("image/jpeg");
    const meta = await (await import("sharp")).default(img.data).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1568);
    expect(f.textCalls[1].images).toBeUndefined();

    const mail = (await nodes(id)).find((x) => x.nodeType === "send_email")!;
    expect(mail.output).toMatchObject({ sent: false, to: ["friend@example.com"], subject: "About your photo Bcc: evil@x.com" });
    expect(f.sent).toEqual([]); // preview mode never sends
  });

  it("sends through the owner's Gmail when preview is off, and redacts the app password", async () => {
    const f = fakes();
    const { user, run, photo } = await setup(definition({ preview: false, body: `{{text_2.text}} ${APP_PASSWORD}` }));
    await createIntegration(user.id, { provider: "gmail", secret: "abcd efgh ijkl mnop", label: "Me@Gmail.com" }, async () => "ACTIVE");
    expect(await resolveGmail(user.id)).toEqual({ user: "me@gmail.com", pass: APP_PASSWORD });

    const id = await run({ photo: photo.id });
    expect(await runExecution(id, f.deps)).toBe("COMPLETED");
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ user: "me@gmail.com", to: ["friend@example.com"], subject: "About your photo Bcc: evil@x.com" });
    const stored = JSON.stringify(await nodes(id));
    expect(stored).not.toContain(APP_PASSWORD);
    expect(stored).toContain("Sent from me@gmail.com");
  });

  it("sends HTML with a plain-text fallback and attaches the uploaded photo", async () => {
    const f = fakes();
    const { user, run, photo } = await setup(definition({ preview: false, format: "html", body: "<h1>Look</h1><p>{{text_2.text}}</p><script>x()</script>", attachments: "{{photo}}" }));
    await createIntegration(user.id, { provider: "gmail", secret: APP_PASSWORD, label: "me@gmail.com" }, async () => "ACTIVE");
    const id = await run({ photo: photo.id });
    expect(await runExecution(id, f.deps)).toBe("COMPLETED");
    const mail = f.sent[0];
    expect(mail.html).toContain("<h1>Look</h1>");
    expect(mail.text).toMatch(/^Look\n/);
    expect(mail.text).not.toContain("<");
    expect(mail.text).not.toContain("x()");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0]).toMatchObject({ filename: "square.png", contentType: "image/png" });
    expect(mail.attachments![0].content.subarray(0, 4).toString("hex")).toBe("89504e47");
    const node = (await nodes(id)).find((x) => x.nodeType === "send_email")!;
    expect(node.output).toMatchObject({ sent: true, attachments: [{ name: "square.png" }] });
    expect(JSON.stringify(node.output)).not.toContain("iVBOR"); // file bytes aren't stored in the run
  });

  it("won't attach someone else's file", async () => {
    const f = fakes();
    const stranger = await createUser("Stranger");
    const theirs = await createAsset(stranger.id, { name: "secret.pdf", buffer: Buffer.from("%PDF-1.4"), mimeType: "application/pdf", extension: "pdf", kind: "DOCUMENT", source: "UPLOAD", tags: [] });
    const { user, run, photo } = await setup(definition({ preview: false, attachments: theirs.id }));
    await createIntegration(user.id, { provider: "gmail", secret: APP_PASSWORD, label: "me@gmail.com" }, async () => "ACTIVE");
    const id = await run({ photo: photo.id });
    expect(await runExecution(id, f.deps)).toBe("FAILED");
    expect(f.sent).toEqual([]);
  });

  it("fails clearly when Gmail isn't connected", async () => {
    const f = fakes();
    const { run, photo } = await setup(definition({ preview: false }));
    const id = await run({ photo: photo.id });
    expect(await runExecution(id, f.deps)).toBe("FAILED");
    expect((await nodes(id)).find((x) => x.nodeType === "send_email")!.error).toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    expect(f.sent).toEqual([]);
  });

  it("rejects recipients that resolve to invalid addresses", async () => {
    const f = fakes();
    const { user, run, photo } = await setup(definition({ preview: false, to: "{{text_1.text}}" }));
    await createIntegration(user.id, { provider: "gmail", secret: APP_PASSWORD, label: "me@gmail.com" }, async () => "ACTIVE");
    const id = await run({ photo: photo.id });
    expect(await runExecution(id, f.deps)).toBe("FAILED");
    expect((await nodes(id)).find((x) => x.nodeType === "send_email")!.error).toMatchObject({ code: "INVALID_DATA" });
    expect(f.sent).toEqual([]);
  });

  it("can't read another user's image", async () => {
    const f = fakes();
    const { run } = await setup(definition());
    const stranger = await createUser("Stranger");
    const theirs = await createAsset(stranger.id, { name: "private.png", buffer: await pngBytes(), mimeType: "image/png", extension: "png", kind: "IMAGE", source: "UPLOAD", tags: [] });
    const id = await run({ photo: theirs.id });
    expect(await runExecution(id, f.deps)).toBe("FAILED");
    expect((await nodes(id)).find((x) => x.nodeType === "ai_text")!.error).toMatchObject({ code: "INVALID_DATA", message: expect.stringContaining("isn't yours") });
    expect(f.textCalls).toEqual([]);
  });

  it("image inputs must be asset ids", () => {
    const schema = [{ name: "photo", type: "image" as const, description: "", required: true, defaultValue: "" }];
    expect(coerceInputs(schema, { photo: "../../etc/passwd" }).errors.photo).toBe("Upload an image");
    expect(coerceInputs(schema, { photo: "cmabcdefghijklmnopqrstuv" }).values.photo).toBe("cmabcdefghijklmnopqrstuv");
  });
});

describe("Gmail integration", () => {
  it("needs a valid address and a 16-letter app password", async () => {
    const u = await createUser();
    await expect(createIntegration(u.id, { provider: "gmail", secret: APP_PASSWORD, label: "not-an-email" }, async () => "ACTIVE")).rejects.toMatchObject({ code: "INVALID_EMAIL" });
    await expect(createIntegration(u.id, { provider: "gmail", secret: "short", label: "me@gmail.com" }, async () => "ACTIVE")).rejects.toMatchObject({ code: "INVALID_KEY_FORMAT" });
    await expect(createIntegration(u.id, { provider: "gmail", secret: APP_PASSWORD, label: "me@gmail.com" }, async () => "INVALID")).rejects.toMatchObject({ code: "KEY_REJECTED", message: expect.stringContaining("Gmail") });
  });
});
