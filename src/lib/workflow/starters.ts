import { NODE_SPECS } from "./registry";
import { WORKFLOW_SCHEMA_VERSION, type NodeConfigMap, type NodeType, type WorkflowDefinition, type WorkflowNode } from "./schema";

export const STARTERS = [
  { id: "blank", label: "Blank canvas", description: "Start from an empty workflow." },
  { id: "text", label: "Text generation", description: "Input → prompt template → AI text → output." },
  { id: "image", label: "Image generation", description: "Input → AI image → saved to your library." },
] as const;
export type StarterId = (typeof STARTERS)[number]["id"];

function node<T extends NodeType>(
  id: string,
  type: T,
  key: string,
  x: number,
  y: number,
  config: Partial<NodeConfigMap[T]> = {},
  label?: string,
): WorkflowNode {
  return {
    id,
    type,
    position: { x, y },
    data: { key, label: label ?? NODE_SPECS[type].label, config: { ...NODE_SPECS[type].defaultConfig(), ...config } },
  };
}

export function starterDefinition(id: StarterId): WorkflowDefinition {
  const base = { schemaVersion: WORKFLOW_SCHEMA_VERSION } as const;
  switch (id) {
    case "blank":
      return { ...base, nodes: [], edges: [] };
    case "text":
      return {
        ...base,
        nodes: [
          node("n_input", "input", "input_1", 0, 80, { fieldName: "topic", description: "What to write about" }, "Topic"),
          node("n_prompt", "prompt_template", "prompt_1", 260, 80, {
            template: "Write a concise, engaging paragraph about {{topic}} for a general audience.",
          }),
          node("n_text", "ai_text", "text_1", 520, 80, { prompt: "{{prompt_1.text}}" }, "Draft"),
          node("n_output", "output", "output_1", 780, 80, { name: "draft", format: "text", value: "{{text_1.text}}" }),
        ],
        edges: [
          { id: "e1", source: "n_input", target: "n_prompt", sourceHandle: "out", targetHandle: "in" },
          { id: "e2", source: "n_prompt", target: "n_text", sourceHandle: "out", targetHandle: "in" },
          { id: "e3", source: "n_text", target: "n_output", sourceHandle: "out", targetHandle: "in" },
        ],
      };
    case "image":
      return {
        ...base,
        nodes: [
          node("n_input", "input", "input_1", 0, 80, { fieldName: "subject", description: "What the image shows" }, "Subject"),
          node("n_image", "ai_image", "image_1", 260, 80, { prompt: "A clean, modern product illustration of {{subject}}" }),
          node("n_output", "output", "output_1", 520, 80, { name: "images", format: "file", value: "{{image_1.images}}", saveToLibrary: true }),
        ],
        edges: [
          { id: "e1", source: "n_input", target: "n_image", sourceHandle: "out", targetHandle: "in" },
          { id: "e2", source: "n_image", target: "n_output", sourceHandle: "out", targetHandle: "in" },
        ],
      };
  }
}
