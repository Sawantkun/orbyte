import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NodeError } from "../engine/errors";
import type { TextGenerationRequest, TextGenerationResult, TextProvider } from "./types";

/**
 * PERSONAL / LOCAL USE ONLY. Runs an AI Text node through the Claude Code CLI
 * installed and signed in on this machine, i.e. the machine owner's own Claude
 * subscription. It must never be enabled on a deployment other people use:
 * offering claude.ai login or subscription limits to other users is not allowed.
 *
 * Isolation: no tools at all (`--tools ""`), no user/project settings or hooks,
 * no MCP servers, no slash commands, no saved session, an empty temporary
 * working directory, and an allow-listed environment so app secrets
 * (DATABASE_URL, ENCRYPTION_KEY, …) never reach the child process.
 */

const ENV_ALLOWLIST = ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "LANG", "LC_ALL", "TMPDIR", "TERM", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR"];
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const BASE_SYSTEM_PROMPT =
  "You are one text-generation step inside an automated workflow. Respond to the user's prompt directly with the requested content only: no preamble, no questions back, no mention of being in a workflow.";

type CliResult = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string;
  api_error_status?: number | null;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  total_cost_usd?: number;
};

export type ClaudeCliRun = { stdout: string; stderr: string; code: number | null };

/** Spawns the CLI; injectable so tests can substitute a fake executable. */
export async function runClaudeCli(cliPath: string, args: string[], input: string, signal: AbortSignal): Promise<ClaudeCliRun> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "orbyte-claude-"));
  const env: Record<string, string> = {};
  for (const k of ENV_ALLOWLIST) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  try {
    return await new Promise<ClaudeCliRun>((resolve, reject) => {
      // Allow-listed env only; Next's types make NODE_ENV required on ProcessEnv, which we intentionally omit.
      const child = spawn(cliPath, args, { cwd, env: env as unknown as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let size = 0;
      const kill = () => child.kill("SIGTERM");
      signal.addEventListener("abort", kill, { once: true });
      child.stdout.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_OUTPUT_BYTES) {
          kill();
          return;
        }
        stdout += c.toString("utf8");
      });
      child.stderr.on("data", (c: Buffer) => {
        if (stderr.length < 8192) stderr += c.toString("utf8");
      });
      child.on("error", (e: NodeJS.ErrnoException) => {
        signal.removeEventListener("abort", kill);
        reject(e);
      });
      child.on("close", (code) => {
        signal.removeEventListener("abort", kill);
        resolve({ stdout, stderr, code });
      });
      child.stdin.on("error", () => {
        /* child exited early; reported via close */
      });
      child.stdin.end(input);
    });
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

export class ClaudeCliProvider implements TextProvider {
  readonly id = "claude-cli";
  constructor(
    private readonly cliPath: string,
    private readonly run: typeof runClaudeCli = runClaudeCli,
  ) {}

  /** CLI arguments: isolation flags are fixed; only model and system prompt vary. */
  static args(model: string, system?: string): string[] {
    return [
      "-p",
      // stream-json lets the prompt carry image content blocks; --verbose is required with it.
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--model", model,
      "--tools", "",
      "--setting-sources", "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--permission-mode", "dontAsk",
      "--system-prompt", system ? `${BASE_SYSTEM_PROMPT}\n\n${system}` : BASE_SYSTEM_PROMPT,
    ];
  }

  /** One stream-json user message: images first, then the prompt text. */
  static message(req: Pick<TextGenerationRequest, "prompt" | "images">): string {
    const content = [
      ...(req.images ?? []).map((img) => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data.toString("base64") } })),
      { type: "text", text: req.prompt },
    ];
    return JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
  }

  async generateText(req: TextGenerationRequest): Promise<TextGenerationResult> {
    let out: ClaudeCliRun;
    try {
      out = await this.run(this.cliPath, ClaudeCliProvider.args(req.model, req.system), ClaudeCliProvider.message(req), req.signal);
    } catch (e) {
      if (req.signal.aborted) throw new NodeError("CANCELLED", "Cancelled", false);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        throw new NodeError("PROVIDER_NOT_CONFIGURED", "The Claude CLI wasn't found. Install Claude Code or set CLAUDE_CLI_PATH.", false);
      }
      throw new NodeError("PROVIDER_ERROR", "The Claude CLI couldn't be started.", false);
    }
    if (req.signal.aborted) throw new NodeError("CANCELLED", "Cancelled", false);

    // stream-json: one JSON object per line; the final "result" event carries the answer.
    let parsed: CliResult | null = null;
    for (const line of out.stdout.split("\n").reverse()) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as CliResult;
        if (ev.type === "result") {
          parsed = ev;
          break;
        }
      } catch {
        /* not JSON; keep looking */
      }
    }

    if (!parsed || parsed.type !== "result") {
      const hint = /log ?in|not authenticated|unauthori[sz]ed|\/login/i.test(out.stderr + out.stdout);
      if (hint) throw new NodeError("PROVIDER_AUTH", "The Claude CLI isn't signed in. Run `claude` in a terminal and sign in, then try again.", false);
      throw new NodeError("PROVIDER_ERROR", `The Claude CLI returned an unexpected response (exit ${out.code ?? "?"}).`, true);
    }
    if (parsed.is_error || parsed.subtype !== "success") {
      const status = parsed.api_error_status ?? null;
      const text = (parsed.result ?? "").slice(0, 300);
      if (status === 429 || /rate limit|usage limit|limit reached/i.test(text)) {
        throw new NodeError("PROVIDER_RATE_LIMIT", "Claude usage limit reached for your subscription. Try again later.", status === 429);
      }
      if (status === 401 || status === 403 || /log ?in|authenticat/i.test(text)) {
        throw new NodeError("PROVIDER_AUTH", "The Claude CLI isn't signed in. Run `claude` in a terminal and sign in, then try again.", false);
      }
      if (status !== null && status >= 500) throw new NodeError("PROVIDER_ERROR", `Claude error (${status}).`, true);
      throw new NodeError("PROVIDER_REJECTED", `The Claude CLI reported an error: ${text || parsed.subtype || "unknown"}`, false);
    }

    const u = parsed.usage ?? {};
    return {
      text: parsed.result ?? "",
      usage: {
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
      },
      truncated: parsed.stop_reason === "max_tokens",
    };
  }
}
