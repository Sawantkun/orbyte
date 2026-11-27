import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as localClaude from "@/app/api/integrations/local-claude/route";
import { localClaudeStatus } from "@/server/local-claude";
import { request, signedInUser } from "../support/api";
import { resetDatabase } from "../support/db";
import { env } from "@/lib/env";
import { ClaudeCliProvider } from "@/server/providers/claude-cli";
import { defaultProviders } from "@/server/providers";

const FAKE = path.resolve("tests/support/fake-claude.mjs");
const provider = () => new ClaudeCliProvider(FAKE);
const gen = (prompt: string, extra: Partial<Parameters<ClaudeCliProvider["generateText"]>[0]> = {}) =>
  provider().generateText({ model: "claude-haiku-5-5", prompt, maxOutputTokens: 100, signal: new AbortController().signal, ...extra });

describe("ClaudeCliProvider (local Claude CLI, fake executable)", () => {
  it("returns the result text and token usage", async () => {
    const r = await gen("Write a haiku");
    expect(r.text).toBe("fake claude-haiku-5-5: Write a haiku");
    expect(r.usage).toEqual({ inputTokens: 103, outputTokens: 7 });
  });

  it("runs isolated: no tools, no settings, no MCP, empty cwd, allow-listed env, prompt via stdin", async () => {
    process.env.DATABASE_URL_PROBE = "must-not-leak";
    const r = JSON.parse((await gen("[echo] hi", { system: "Be brief" })).text);
    delete process.env.DATABASE_URL_PROBE;
    const a: string[] = r.args;
    const val = (flag: string) => a[a.indexOf(flag) + 1];
    expect(a).toContain("-p");
    expect(val("--input-format")).toBe("stream-json");
    expect(val("--output-format")).toBe("stream-json");
    expect(val("--tools")).toBe("");
    expect(val("--setting-sources")).toBe("");
    expect(a).toEqual(expect.arrayContaining(["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]));
    expect(val("--permission-mode")).toBe("dontAsk");
    expect(val("--system-prompt")).toMatch(/text-generation step[\s\S]*Be brief$/);
    expect(a).not.toContain("--bare"); // --bare would disable subscription (OAuth) auth
    expect(a.join(" ")).not.toContain("hi"); // prompt is not passed as an argument
    expect(r.prompt).toBe("[echo] hi");
    expect(r.cwdEntries).toEqual([]);
    for (const k of r.envKeys) expect(["HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TERM", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR", "__CF_USER_TEXT_ENCODING"]).toContain(k);
    expect(r.envKeys).not.toContain("DATABASE_URL");
    expect(r.envKeys).not.toContain("ENCRYPTION_KEY");
  });

  it("sends images as content blocks alongside the prompt", async () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const r = await gen("Describe this", { images: [{ data: png, mimeType: "image/png" }] });
    expect(r.text).toBe(`fake claude-haiku-5-5 saw 1 image(s) (image/png:${png.toString("base64").length}): Describe this`);
  });

  it.each([
    ["[auth]", "PROVIDER_AUTH", false],
    ["[limit]", "PROVIDER_RATE_LIMIT", true],
    ["[garbage]", "PROVIDER_ERROR", true],
  ] as const)("maps %s to %s", async (marker, code, retryable) => {
    await expect(gen(marker)).rejects.toMatchObject({ code, retryable });
  });

  it("reports a missing CLI clearly", async () => {
    await expect(new ClaudeCliProvider("/nonexistent/claude").generateText({ model: "m", prompt: "x", maxOutputTokens: 1, signal: new AbortController().signal })).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
  });

  it("kills the CLI on cancel", async () => {
    const ctrl = new AbortController();
    const started = Date.now();
    const p = gen("[slow]", { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 200);
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("local CLI owner-only switch", () => {
  const e = env as { LOCAL_CLAUDE_CLI: "allow" | "off"; CLAUDE_CLI_PATH: string };
  const saved = { ...e };
  beforeEach(async () => {
    await resetDatabase();
    e.CLAUDE_CLI_PATH = FAKE;
  });
  afterEach(() => Object.assign(e, saved));

  const toggle = (cookie: string, enabled: boolean) =>
    localClaude.POST(request("/api/integrations/local-claude", { method: "POST", cookie, body: { enabled } }), {} as never);

  it("is off until switched on, then only the owner can use it", async () => {
    const owner = await signedInUser("Owner");
    const other = await signedInUser("Other");
    await expect(defaultProviders.text("claude-cli", owner.id)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED", message: expect.stringContaining("Switch it on in Integrations") });

    const on = await toggle(owner.cookie, true);
    expect(on.status).toBe(200);
    expect((await on.json()).data).toMatchObject({ available: true, enabledByMe: true, ownedByOther: false });

    const r = await defaultProviders.text("claude-cli", owner.id);
    expect(r.source).toBe("local-cli");
    expect(r.secrets).toEqual([]);
    await expect(r.provider.generateText({ model: "claude-sonnet-5-5", prompt: "ping", maxOutputTokens: 5, signal: new AbortController().signal })).resolves.toMatchObject({ text: "fake claude-sonnet-5-5: ping" });

    // Another account can neither claim it nor run through it.
    expect((await toggle(other.cookie, true)).status).toBe(409);
    await expect(defaultProviders.text("claude-cli", other.id)).rejects.toMatchObject({ message: expect.stringContaining("reserved for the account that switched it on") });
    expect((await localClaudeStatus(other.id)).ownedByOther).toBe(true);
    // …and switching "off" as a non-owner changes nothing.
    await toggle(other.cookie, false);
    expect((await localClaudeStatus(owner.id)).enabledByMe).toBe(true);
  });

  it("switching off releases it for the next account", async () => {
    const a = await signedInUser("A");
    const b = await signedInUser("B");
    await toggle(a.cookie, true);
    await toggle(a.cookie, false);
    await expect(defaultProviders.text("claude-cli", a.id)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    expect((await toggle(b.cookie, true)).status).toBe(200);
  });

  it("can be hard-disabled for the whole instance", async () => {
    const a = await signedInUser("A");
    e.LOCAL_CLAUDE_CLI = "off";
    expect((await toggle(a.cookie, true)).status).toBe(403);
    expect(await localClaudeStatus(a.id)).toMatchObject({ available: false });
  });

  it("does not offer image generation", async () => {
    const a = await signedInUser("A");
    await toggle(a.cookie, true);
    await expect(defaultProviders.image("claude-cli", a.id)).rejects.toMatchObject({ code: "PROVIDER_UNSUPPORTED" });
  });
});
