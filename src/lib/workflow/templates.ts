/**
 * Template references: `{{key}}` or `{{key.path.to.field}}`.
 * `key` is either an Input node's field name or another node's key.
 */
export const TEMPLATE_REF = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)((?:\.[a-zA-Z0-9_]+)*)\s*\}\}/g;

export type TemplateRef = { raw: string; root: string; path: string[] };

export function extractRefs(text: string | undefined | null): TemplateRef[] {
  if (!text) return [];
  const refs: TemplateRef[] = [];
  for (const m of text.matchAll(TEMPLATE_REF)) {
    refs.push({ raw: m[0], root: m[1], path: m[2] ? m[2].slice(1).split(".") : [] });
  }
  return refs;
}

/** Unique variable names in a reusable prompt template, in first-seen order. */
export function templateVariables(text: string): string[] {
  return [...new Set(extractRefs(text).map((r) => r.root))];
}

/** Collect every string value in a config object (recursively) for reference scanning. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}
