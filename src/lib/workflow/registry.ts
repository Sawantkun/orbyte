import { DEFAULT_IMAGE_MODEL, DEFAULT_TEXT_MODEL } from "@/config/ai-models";
import type { NodeConfigMap, NodeType } from "./schema";

export type NodeCategory = "Inputs" | "AI" | "Logic" | "Data" | "Outputs";

export type NodeSpec<T extends NodeType = NodeType> = {
  type: T;
  label: string;
  description: string;
  category: NodeCategory;
  /** Accepts incoming connections on handle "in". */
  hasInput: boolean;
  /** Source handle ids. */
  outputs: readonly string[];
  /** Fields this node exposes to downstream templates as {{key.field}}. */
  outputFields: readonly string[];
  /** Prefix for auto-generated node keys, e.g. "summary_1". */
  keyPrefix: string;
  defaultConfig: () => NodeConfigMap[T];
};

const spec = <T extends NodeType>(s: NodeSpec<T>) => s;

export const NODE_SPECS: { [K in NodeType]: NodeSpec<K> } = {
  input: spec({
    type: "input",
    label: "Input",
    description: "A value provided when the workflow runs.",
    category: "Inputs",
    hasInput: false,
    outputs: ["out"],
    outputFields: [],
    keyPrefix: "input",
    defaultConfig: () => ({ fieldName: "topic", fieldType: "text", description: "", required: true, defaultValue: "" }),
  }),
  prompt_template: spec({
    type: "prompt_template",
    label: "Prompt Template",
    description: "Fill a reusable prompt with {{variables}}.",
    category: "AI",
    hasInput: true,
    outputs: ["out"],
    outputFields: ["text"],
    keyPrefix: "prompt",
    defaultConfig: () => ({ templateId: null, template: "" }),
  }),
  ai_text: spec({
    type: "ai_text",
    label: "AI Text",
    description: "Generate text with a language model.",
    category: "AI",
    hasInput: true,
    outputs: ["out"],
    outputFields: ["text"],
    keyPrefix: "text",
    defaultConfig: () => ({
      provider: DEFAULT_TEXT_MODEL.provider,
      model: DEFAULT_TEXT_MODEL.model,
      systemPrompt: "",
      prompt: "",
      temperature: 0.7,
      maxOutputTokens: 1024,
    }),
  }),
  ai_image: spec({
    type: "ai_image",
    label: "AI Image",
    description: "Generate images; results can be saved to the library.",
    category: "AI",
    hasInput: true,
    outputs: ["out"],
    outputFields: ["images"],
    keyPrefix: "image",
    defaultConfig: () => ({
      provider: DEFAULT_IMAGE_MODEL.provider,
      model: DEFAULT_IMAGE_MODEL.model,
      prompt: "",
      aspectRatio: "1:1",
      quality: "standard",
      count: 1,
      saveToLibrary: true,
    }),
  }),
  condition: spec({
    type: "condition",
    label: "Condition",
    description: "Branch on a comparison. Untaken branches are skipped.",
    category: "Logic",
    hasInput: true,
    outputs: ["true", "false"],
    outputFields: ["result"],
    keyPrefix: "check",
    defaultConfig: () => ({ left: "", operator: "equals", right: "" }),
  }),
  transform: spec({
    type: "transform",
    label: "Transform",
    description: "Reshape text or JSON with safe built-in operations.",
    category: "Data",
    hasInput: true,
    outputs: ["out"],
    outputFields: ["result"],
    keyPrefix: "transform",
    defaultConfig: () => ({ operation: "template", input: "", argument: "", replacement: "" }),
  }),
  http_request: spec({
    type: "http_request",
    label: "HTTP Request",
    description: "Call an external HTTPS API.",
    category: "Data",
    hasInput: true,
    outputs: ["out"],
    outputFields: ["status", "body", "headers"],
    keyPrefix: "http",
    defaultConfig: () => ({ method: "GET", url: "https://", headers: [], body: "", timeoutMs: 10_000, responseType: "json" }),
  }),
  output: spec({
    type: "output",
    label: "Output",
    description: "Collect a result; optionally save it to the asset library.",
    category: "Outputs",
    hasInput: true,
    outputs: [],
    outputFields: [],
    keyPrefix: "output",
    defaultConfig: () => ({ name: "result", format: "text", value: "", saveToLibrary: false, metadata: [] }),
  }),
};

export const NODE_CATEGORIES: NodeCategory[] = ["Inputs", "AI", "Logic", "Data", "Outputs"];

/** Next free key like "text_2", given the keys already in use. */
export function nextNodeKey(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; ; i++) {
    const k = `${prefix}_${i}`;
    if (!used.has(k)) return k;
  }
}
