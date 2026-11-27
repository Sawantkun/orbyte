/** Providers users can connect. `available: false` entries render as "coming soon", never as working. */
export const INTEGRATION_PROVIDERS = [
  {
    id: "openai",
    kind: "api-key",
    category: "ai",
    name: "OpenAI",
    description: "Text and image generation for AI Text and AI Image nodes.",
    available: true,
    keyPlaceholder: "sk-…",
    keyPattern: /^sk-[A-Za-z0-9_-]{20,200}$/,
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    // Secret = Google app password (16 letters); the Gmail address is stored as the label.
    id: "gmail",
    kind: "gmail",
    category: "email",
    name: "Gmail",
    description: "Send emails from your Gmail with the Send Email node.",
    available: true,
    keyPlaceholder: "xxxx xxxx xxxx xxxx",
    keyPattern: /^[a-z]{16}$/i,
    docsUrl: "https://myaccount.google.com/apppasswords",
  },
  { id: "anthropic", kind: "api-key", category: "ai", name: "Anthropic", description: "Claude models for text generation.", available: false, keyPlaceholder: "", keyPattern: /.^/, docsUrl: "" },
  { id: "google", kind: "api-key", category: "ai", name: "Google Gemini", description: "Gemini models for text and images.", available: false, keyPlaceholder: "", keyPattern: /.^/, docsUrl: "" },
] as const;

export type IntegrationProviderId = (typeof INTEGRATION_PROVIDERS)[number]["id"];

export const findIntegrationProvider = (id: string) => INTEGRATION_PROVIDERS.find((p) => p.id === id);
