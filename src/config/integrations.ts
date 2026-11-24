/** Providers users can connect. `available: false` entries render as "coming soon", never as working. */
export const INTEGRATION_PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    description: "Text and image generation for AI Text and AI Image nodes.",
    available: true,
    keyPlaceholder: "sk-…",
    keyPattern: /^sk-[A-Za-z0-9_-]{20,200}$/,
    docsUrl: "https://platform.openai.com/api-keys",
  },
  { id: "anthropic", name: "Anthropic", description: "Claude models for text generation.", available: false, keyPlaceholder: "", keyPattern: /.^/, docsUrl: "" },
  { id: "google", name: "Google Gemini", description: "Gemini models for text and images.", available: false, keyPlaceholder: "", keyPattern: /.^/, docsUrl: "" },
] as const;

export type IntegrationProviderId = (typeof INTEGRATION_PROVIDERS)[number]["id"];

export const findIntegrationProvider = (id: string) => INTEGRATION_PROVIDERS.find((p) => p.id === id);
