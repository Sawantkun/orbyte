import type { InputField } from "@/lib/workflow/schema";

export type InputErrors = Record<string, string>;

/** Validate and coerce run inputs against a version's input schema. Unknown keys are dropped. */
export function coerceInputs(schema: InputField[], raw: Record<string, unknown>): { values: Record<string, unknown>; errors: InputErrors } {
  const values: Record<string, unknown> = {};
  const errors: InputErrors = {};
  for (const field of schema) {
    let v = raw[field.name];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) v = field.defaultValue === "" ? undefined : field.defaultValue;
    if (v === undefined) {
      if (field.required) errors[field.name] = "Required";
      else values[field.name] = null;
      continue;
    }
    switch (field.type) {
      case "text":
      case "file":
        if (typeof v !== "string") errors[field.name] = "Must be text";
        else if (v.length > 100_000) errors[field.name] = "Too long";
        else values[field.name] = v;
        break;
      case "number": {
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
        if (!Number.isFinite(n)) errors[field.name] = "Must be a number";
        else values[field.name] = n;
        break;
      }
      case "boolean":
        if (typeof v === "boolean") values[field.name] = v;
        else if (v === "true" || v === "false") values[field.name] = v === "true";
        else errors[field.name] = "Must be true or false";
        break;
      case "json":
        if (typeof v === "string") {
          try {
            values[field.name] = JSON.parse(v);
          } catch {
            errors[field.name] = "Must be valid JSON";
          }
        } else values[field.name] = v;
        break;
    }
  }
  return { values, errors };
}
