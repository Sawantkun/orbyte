import type { ConditionOperator, TransformOperation } from "@/lib/workflow/schema";

export class OperationError extends Error {}

const MAX_RESULT_CHARS = 1_000_000;

function asText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function getPath(value: unknown, path: string): unknown {
  let cur = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Declarative transforms only — nothing here evaluates user-supplied code. */
export function runTransform(op: TransformOperation, input: unknown, argument: string, replacement: string): unknown {
  let result: unknown;
  switch (op) {
    case "template":
      result = asText(input);
      break;
    case "trim":
      result = asText(input).trim();
      break;
    case "uppercase":
      result = asText(input).toUpperCase();
      break;
    case "lowercase":
      result = asText(input).toLowerCase();
      break;
    case "truncate": {
      const n = Number(argument);
      if (!Number.isInteger(n) || n < 0) throw new OperationError("Truncate length must be a whole number");
      result = Array.from(asText(input)).slice(0, n).join("");
      break;
    }
    case "replace":
      if (!argument) throw new OperationError("Text to find is required");
      result = asText(input).split(argument).join(replacement);
      break;
    case "split":
      result = asText(input).split(argument || "\n");
      break;
    case "join":
      if (!Array.isArray(input)) {
        // Accept JSON array text too.
        try {
          const parsed = JSON.parse(asText(input));
          if (Array.isArray(parsed)) {
            result = parsed.map(asText).join(argument || "\n");
            break;
          }
        } catch {
          /* fall through */
        }
        throw new OperationError("Join needs a list");
      }
      result = input.map(asText).join(argument || "\n");
      break;
    case "json_parse":
      if (typeof input !== "string") {
        result = input;
        break;
      }
      try {
        result = JSON.parse(input);
      } catch {
        throw new OperationError("Input is not valid JSON");
      }
      break;
    case "json_stringify":
      result = JSON.stringify(input, null, 2);
      break;
    case "json_get": {
      let source = input;
      if (typeof source === "string") {
        try {
          source = JSON.parse(source);
        } catch {
          throw new OperationError("Input is not valid JSON");
        }
      }
      const v = getPath(source, argument);
      result = v === undefined ? null : v;
      break;
    }
  }
  if (asText(result).length > MAX_RESULT_CHARS) throw new OperationError("Result is too large");
  return result;
}

const toNumber = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

export function evaluateCondition(op: ConditionOperator, left: unknown, right: unknown): boolean {
  switch (op) {
    case "exists":
      return !(left === null || left === undefined || (typeof left === "string" && left.trim() === "") || (Array.isArray(left) && left.length === 0));
    case "equals":
      return asText(left).trim() === asText(right).trim();
    case "not_equals":
      return asText(left).trim() !== asText(right).trim();
    case "contains":
      if (Array.isArray(left)) return left.some((x) => asText(x) === asText(right));
      return asText(left).toLowerCase().includes(asText(right).toLowerCase());
    case "greater_than":
    case "less_than": {
      const a = toNumber(left);
      const b = toNumber(right);
      if (Number.isNaN(a) || Number.isNaN(b)) throw new OperationError(`Cannot compare non-numbers (${asText(left)} vs ${asText(right)})`);
      return op === "greater_than" ? a > b : a < b;
    }
  }
}
