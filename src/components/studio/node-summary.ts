import { modelsFor } from "@/config/ai-models";
import type { NodeType } from "@/lib/workflow/schema";

const s = (v: unknown) => (typeof v === "string" ? v : "");
const clip = (v: string, n = 46) => (v.length > n ? v.slice(0, n - 1) + "…" : v);

/** One-line description of a node's configuration, shown on the canvas. */
export function nodeSummary(type: NodeType, c: Record<string, unknown>): string {
  switch (type) {
    case "input":
      return `${s(c.fieldName) || "unnamed"} · ${s(c.fieldType)}${c.required ? "" : " · optional"}`;
    case "ai_text":
    case "ai_image": {
      const model = modelsFor(s(c.provider), type === "ai_text" ? "text" : "image").find((m) => m.id === c.model);
      return model?.label ?? (s(c.model) || "No model");
    }
    case "prompt_template":
      return clip(s(c.template)) || "Empty template";
    case "condition":
      return clip(`${s(c.left) || "…"} ${s(c.operator).replace("_", " ")} ${c.operator === "exists" ? "" : s(c.right)}`.trim());
    case "transform":
      return s(c.operation).replace("_", " ");
    case "http_request":
      return clip(`${s(c.method)} ${s(c.url).replace(/^https?:\/\//, "")}`);
    case "output":
      return `${s(c.name)} · ${s(c.format)}${c.saveToLibrary ? " · library" : ""}`;
  }
}
