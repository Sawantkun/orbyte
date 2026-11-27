export type TextGenerationRequest = {
  model: string;
  system?: string;
  prompt: string;
  maxOutputTokens: number;
  /** Only sent when the model supports it (see the model catalogue). */
  temperature?: number;
  /** Images for the model to look at (already size-limited by the engine). */
  images?: { data: Buffer; mimeType: string }[];
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

export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  quality: "auto" | "low" | "medium" | "high";
  count: number;
  signal: AbortSignal;
};

export type ImageGenerationResult = {
  images: { data: Buffer; mimeType: string }[];
  usage: { inputTokens: number; outputTokens: number };
};

export interface ImageProvider {
  readonly id: string;
  generateImages(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

/** A provider client plus the secrets to redact and where the credential came from. */
export type ResolvedProvider<P> = { provider: P; secrets: string[]; source?: "user" | "platform" | "local-cli" };

/** Resolves a provider client for a user. Throws NodeError("PROVIDER_NOT_CONFIGURED") if no credential exists. */
export type ProviderResolver = {
  text(providerId: string, ownerId: string): Promise<ResolvedProvider<TextProvider>>;
  image(providerId: string, ownerId: string): Promise<ResolvedProvider<ImageProvider>>;
};
