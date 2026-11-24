import { TEMPLATE_REF } from "@/lib/workflow/templates";

/**
 * Run-time values available to templates:
 *   inputs  — Input field name → coerced value
 *   outputs — node key → that node's output object
 */
export type Scope = { inputs: Record<string, unknown>; outputs: Record<string, Record<string, unknown>> };

const MISSING = Symbol("missing");

function lookup(scope: Scope, root: string, path: string[]): unknown {
  let value: unknown = Object.hasOwn(scope.inputs, root) ? scope.inputs[root] : Object.hasOwn(scope.outputs, root) ? scope.outputs[root] : MISSING;
  for (const part of path) {
    if (value === MISSING || value === null || typeof value !== "object") return MISSING;
    value = Array.isArray(value) && /^\d+$/.test(part) ? value[Number(part)] : (value as Record<string, unknown>)[part];
    if (value === undefined) return MISSING;
  }
  return value;
}

export function stringify(value: unknown): string {
  if (value === MISSING || value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export type ResolveResult<T> = { value: T; missing: string[] };

/** Interpolate `{{refs}}` into text. Unresolvable refs become "" and are reported. */
export function resolveText(text: string, scope: Scope): ResolveResult<string> {
  const missing: string[] = [];
  const value = text.replace(TEMPLATE_REF, (raw, root: string, rest: string) => {
    const v = lookup(scope, root, rest ? rest.slice(1).split(".") : []);
    if (v === MISSING) missing.push(raw);
    return stringify(v);
  });
  return { value, missing };
}

/**
 * Like resolveText, but when the whole string is a single reference the raw
 * value is returned (so objects/arrays/numbers keep their type).
 */
export function resolveValue(text: string, scope: Scope): ResolveResult<unknown> {
  const m = text.trim().match(new RegExp(`^${TEMPLATE_REF.source}$`));
  if (m) {
    const v = lookup(scope, m[1], m[2] ? m[2].slice(1).split(".") : []);
    return v === MISSING ? { value: null, missing: [m[0]] } : { value: v, missing: [] };
  }
  return resolveText(text, scope);
}
