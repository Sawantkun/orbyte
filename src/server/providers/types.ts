export type TextGenerationRequest = {
  model: string;
  system?: string;
  prompt: string;
  maxOutputTokens: number;
  /** Only sent when the model supports it (see the model catalogue). */
  temperature?: number;
  signal: AbortSignal;
};

export type TextGenerationResult = {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Provider finished early (e.g. hit max tokens). */
  truncated: boolean;
};

export interface TextProvider {
  readonly id: string;
  generateText(req: TextGenerationRequest): Promise<TextGenerationResult>;
}

/** Resolves a provider client for a user. Throws NodeError("PROVIDER_NOT_CONFIGURED") if no credential exists. */
export type ProviderResolver = {
  text(providerId: string, ownerId: string): Promise<{ provider: TextProvider; secrets: string[] }>;
};
