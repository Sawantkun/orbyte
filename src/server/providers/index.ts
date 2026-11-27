import "server-only";
import { env } from "@/lib/env";
import { NodeError } from "../engine/errors";
import { markIntegrationInvalid, resolveUserSecret } from "../integrations";
import { canUseLocalClaude } from "../local-claude";
import { ClaudeCliProvider } from "./claude-cli";
import { OpenAIProvider } from "./openai";
import type { ProviderResolver, ResolvedProvider } from "./types";

/**
 * Credential precedence: the user's connected key → the platform key
 * (OPENAI_API_KEY) → a clear "not configured" error. A user key the provider
 * rejects at run time is marked INVALID so the Integrations page shows it.
 */
async function resolveOpenAI(ownerId: string): Promise<ResolvedProvider<OpenAIProvider>> {
  const user = await resolveUserSecret(ownerId, "openai");
  if (user && "secret" in user) {
    const inner = new OpenAIProvider(user.secret, env.OPENAI_BASE_URL);
    const markOnAuth = async <T,>(p: Promise<T>): Promise<T> => {
      try {
        return await p;
      } catch (e) {
        if (e instanceof NodeError && e.code === "PROVIDER_AUTH") {
          await markIntegrationInvalid(user.integrationId);
          throw new NodeError("PROVIDER_AUTH", "OpenAI rejected your API key. Update it in Integrations.", false);
        }
        throw e;
      }
    };
    const provider = Object.assign(Object.create(inner) as OpenAIProvider, {
      generateText: (req: Parameters<OpenAIProvider["generateText"]>[0]) => markOnAuth(inner.generateText(req)),
      generateImages: (req: Parameters<OpenAIProvider["generateImages"]>[0]) => markOnAuth(inner.generateImages(req)),
    });
    return { provider, secrets: [user.secret], source: "user" };
  }
  if (user && "invalid" in user && !env.OPENAI_API_KEY) {
    throw new NodeError("PROVIDER_AUTH", "Your OpenAI key was rejected. Update it in Integrations.", false);
  }
  if (env.OPENAI_API_KEY) {
    return { provider: new OpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL), secrets: [env.OPENAI_API_KEY], source: "platform" };
  }
  throw new NodeError("PROVIDER_NOT_CONFIGURED", "No OpenAI key is available. Connect one in Integrations.", false);
}

function unsupported(providerId: string): never {
  throw new NodeError("PROVIDER_UNSUPPORTED", `Provider "${providerId}" can't run workflows yet.`, false);
}

/** Personal use: the owner's signed-in Claude Code CLI on this machine (see claude-cli.ts, local-claude.ts). */
async function resolveClaudeCli(ownerId: string): Promise<ResolvedProvider<ClaudeCliProvider>> {
  const access = await canUseLocalClaude(ownerId);
  if (!access.ok) {
    const message = {
      off: "The local Claude CLI is disabled on this instance.",
      not_enabled: "Claude (local CLI) is off. Switch it on in Integrations.",
      other_owner: "Claude (local CLI) is reserved for the account that switched it on.",
    }[access.reason];
    throw new NodeError("PROVIDER_NOT_CONFIGURED", message, false);
  }
  return { provider: new ClaudeCliProvider(env.CLAUDE_CLI_PATH), secrets: [], source: "local-cli" };
}

export const defaultProviders: ProviderResolver = {
  async text(providerId, ownerId) {
    if (providerId === "openai") return resolveOpenAI(ownerId);
    if (providerId === "claude-cli") return resolveClaudeCli(ownerId);
    return unsupported(providerId);
  },
  async image(providerId, ownerId) {
    return providerId === "openai" ? resolveOpenAI(ownerId) : unsupported(providerId);
  },
};
