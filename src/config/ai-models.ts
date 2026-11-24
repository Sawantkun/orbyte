/**
 * Provider & model catalogue used by the editor. Pricing and capability
 * metadata live here (one place) rather than being hard-coded in nodes.
 * Execution-time adapters (Milestone 3) read the same catalogue.
 */
export type ModelCapability = "text" | "image";

export type ModelInfo = {
  id: string;
  label: string;
  capability: ModelCapability;
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
      { id: "gpt-4.1", label: "GPT-4.1", capability: "text" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini", capability: "text" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", capability: "text" },
      { id: "gpt-image-1", label: "GPT Image 1", capability: "image" },
    ],
  },
];

export const DEFAULT_TEXT_MODEL = { provider: "openai", model: "gpt-4.1-mini" } as const;
export const DEFAULT_IMAGE_MODEL = { provider: "openai", model: "gpt-image-1" } as const;

export function modelsFor(provider: string, capability: ModelCapability): ModelInfo[] {
  return PROVIDERS.find((p) => p.id === provider)?.models.filter((m) => m.capability === capability) ?? [];
}

export function isKnownModel(provider: string, model: string, capability: ModelCapability) {
  return modelsFor(provider, capability).some((m) => m.id === model);
}
