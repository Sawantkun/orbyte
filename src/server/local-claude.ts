import "server-only";
import { execFile } from "node:child_process";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { recordActivity } from "./activity";
import { AppError, conflict } from "./errors";

/**
 * Personal-use local Claude CLI provider, switched on from the Integrations page.
 *
 * Owner-only: the account that switches it on owns it, and only that account's
 * workflows may run through the Claude Code CLI signed in on this machine.
 * Anyone else on the same instance sees it as unavailable, so nobody can spend
 * the owner's subscription. Switching it off releases it.
 */
const KEY = "local_claude_cli";

export type LocalClaudeStatus = {
  /** Allowed on this instance (env LOCAL_CLAUDE_CLI != "off"). */
  available: boolean;
  enabledByMe: boolean;
  ownedByOther: boolean;
  /** Installed CLI version, or null if it couldn't be found. */
  version: string | null;
};

async function ownerId(): Promise<string | null> {
  const row = await db.instanceSetting.findUnique({ where: { key: KEY } });
  const v = row?.value as { ownerId?: unknown } | undefined;
  return typeof v?.ownerId === "string" ? v.ownerId : null;
}

/** True only for the owning account (and only if the instance allows it). */
export async function canUseLocalClaude(userId: string): Promise<{ ok: true } | { ok: false; reason: "off" | "not_enabled" | "other_owner" }> {
  if (env.LOCAL_CLAUDE_CLI === "off") return { ok: false, reason: "off" };
  const owner = await ownerId();
  if (!owner) return { ok: false, reason: "not_enabled" };
  return owner === userId ? { ok: true } : { ok: false, reason: "other_owner" };
}

export async function setLocalClaude(userId: string, enabled: boolean): Promise<LocalClaudeStatus> {
  if (env.LOCAL_CLAUDE_CLI === "off") throw new AppError(403, "LOCAL_CLAUDE_DISABLED", "The local Claude CLI is disabled on this instance.");
  const owner = await ownerId();
  if (enabled) {
    if (owner && owner !== userId) throw conflict("Another account on this instance already uses the local Claude CLI.");
    if (!owner) {
      try {
        await db.instanceSetting.create({ data: { key: KEY, value: { ownerId: userId } } });
      } catch (e) {
        // Lost a race with another account switching it on at the same moment.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("Another account on this instance already uses the local Claude CLI.");
        throw e;
      }
      await recordActivity({ ownerId: userId, action: "integration.added", entityType: "integration", metadata: { name: "Claude (local CLI)" } });
    }
  } else if (owner === userId) {
    await db.instanceSetting.deleteMany({ where: { key: KEY } });
    await recordActivity({ ownerId: userId, action: "integration.removed", entityType: "integration", metadata: { name: "Claude (local CLI)" } });
  }
  return localClaudeStatus(userId);
}

let versionCache: { at: number; value: string | null } | null = null;

async function cliVersion(): Promise<string | null> {
  if (versionCache && Date.now() - versionCache.at < 60_000) return versionCache.value;
  const value = await new Promise<string | null>((resolve) => {
    // Minimal env (PATH/HOME only); cast because Next's types require NODE_ENV on ProcessEnv.
    const childEnv = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } as unknown as NodeJS.ProcessEnv;
    execFile(env.CLAUDE_CLI_PATH, ["--version"], { timeout: 5000, env: childEnv, encoding: "utf8" }, (err, stdout) =>
      resolve(err ? null : stdout.trim().split("\n")[0].slice(0, 80) || null),
    );
  });
  versionCache = { at: Date.now(), value };
  return value;
}

export async function localClaudeStatus(userId: string): Promise<LocalClaudeStatus> {
  if (env.LOCAL_CLAUDE_CLI === "off") return { available: false, enabledByMe: false, ownedByOther: false, version: null };
  const [owner, version] = await Promise.all([ownerId(), cliVersion()]);
  return { available: true, enabledByMe: owner === userId, ownedByOther: owner !== null && owner !== userId, version };
}
