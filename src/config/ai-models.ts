/**
 * Provider & model catalogue: the single place for model ids, capabilities
 * and pricing. The editor, the validator and the execution engine all read it.
 *
 * Source: https://developers.openai.com/api/docs/pricing (standard tier,
 * short context), checked 2026-11-25. Update `PRICING_CHECKED_AT` when
 * refreshing. Models without a `pricing` entry record usage with cost = null
 * ("unknown") rather than an invented number.
 */
export const PRICING_CHECKED_AT = "2026-11-25";

export type ModelCapability = "text" | "image";

export type ModelInfo = {
  id: string;
  label: string;
  capability: ModelCapability;
  /** Whether the model accepts `temperature`. Reasoning models generally do not. */
  supportsTemperature?: boolean;
  /** USD per 1M tokens. */
  pricing?: { input: number; output: number };
  legacy?: boolean;
};

export type ProviderInfo = {
  id: string;
  label: string;
  /** False until an execution adapter exists for this provider. */
  executable: boolean;
  models: ModelInfo[];
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "openai",
    label: "OpenAI",
    executable: true,
    models: [
      { id: "gpt-6.2-astra", label: "GPT-6.2 Astra", capability: "text", pricing: { input: 8, output: 40 } },
      { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", capability: "text", pricing: { input: 2, output: 10 } },
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", capability: "text", pricing: { input: 1, output: 5 } },
      { id: "gpt-6-luna", label: "GPT-6 Luna", capability: "text", pricing: { input: 0.1, output: 0.5 } },
      { id: "gpt-4.1", label: "GPT-4.1 (legacy)", capability: "text", supportsTemperature: true, legacy: true, pricing: { input: 2, output: 8 } },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini (legacy)", capability: "text", supportsTemperature: true, legacy: true, pricing: { input: 0.4, output: 1.6 } },
      // Image models: prompt (text input) $5 / 1M tokens, image output $30 / 1M tokens.
      { id: "gpt-image-2.6-sunburst", label: "GPT-Image-2.6 Sunburst", capability: "image", pricing: { input: 5, output: 30 } },
      { id: "gpt-image-2.6-flare", label: "GPT-Image-2.6 Flare", capability: "image", pricing: { input: 5, output: 30 } },
    ],
  },
];

export const DEFAULT_TEXT_MODEL = { provider: "openai", model: "gpt-6.2-sol" } as const;
export const DEFAULT_IMAGE_MODEL = { provider: "openai", model: "gpt-image-2.6-flare" } as const;

export function modelsFor(provider: string, capability: ModelCapability): ModelInfo[] {
  return PROVIDERS.find((p) => p.id === provider)?.models.filter((m) => m.capability === capability) ?? [];
}

export function findModel(provider: string, model: string): ModelInfo | undefined {
  return PROVIDERS.find((p) => p.id === provider)?.models.find((m) => m.id === model);
}

export function isKnownModel(provider: string, model: string, capability: ModelCapability) {
  return modelsFor(provider, capability).some((m) => m.id === model);
}

/** Estimated USD cost, or null when pricing is unknown. */
export function estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number | null {
  const p = findModel(provider, model)?.pricing;
  if (!p) return null;
  return Math.round(((inputTokens * p.input + outputTokens * p.output) / 1_000_000) * 1e6) / 1e6;
}
