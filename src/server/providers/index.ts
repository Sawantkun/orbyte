import "server-only";
import { env } from "@/lib/env";
import { NodeError } from "../engine/errors";
import { OpenAIProvider } from "./openai";
import type { ProviderResolver } from "./types";

/**
 * Default resolver. Milestone 3: the platform credential from the environment.
 * Milestone 5 adds per-user encrypted keys (looked up by ownerId) ahead of it.
 */
export const defaultProviders: ProviderResolver = {
  async text(providerId) {
    if (providerId !== "openai") throw new NodeError("PROVIDER_UNSUPPORTED", `Provider "${providerId}" can't run workflows yet.`, false);
    if (!env.OPENAI_API_KEY) {
      throw new NodeError("PROVIDER_NOT_CONFIGURED", "OpenAI isn't configured. Set OPENAI_API_KEY on the server (or add a key in Integrations once available).", false);
    }
    return { provider: new OpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL), secrets: [env.OPENAI_API_KEY] };
  },
};
