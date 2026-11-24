import { describe, expect, it } from "vitest";
import { coerceInputs } from "@/lib/engine/inputs";
import { evaluateCondition, runTransform } from "@/lib/engine/operations";
import { REDACTED, redact } from "@/lib/engine/redact";
import { resolveText, resolveValue, type Scope } from "@/lib/engine/resolve";

const scope: Scope = {
  inputs: { topic: "otters", count: 3, tags: ["a", "b"], empty: null },
  outputs: { text_1: { text: "Hello" }, http_1: { status: 200, body: { items: [{ title: "First" }] } } },
};

describe("template resolution", () => {
  it("interpolates inputs, node outputs and nested paths", () => {
    expect(resolveText("About {{topic}}: {{text_1.text}} / {{http_1.body.items.0.title}}", scope)).toEqual({ value: "About otters: Hello / First", missing: [] });
  });
  it("stringifies non-strings and reports missing refs", () => {
    expect(resolveText("{{count}} {{tags}} {{nope}} {{text_1.missing}}", scope)).toEqual({ value: '3 ["a","b"]  ', missing: ["{{nope}}", "{{text_1.missing}}"] });
  });
  it("keeps the raw value for a whole-string reference", () => {
    expect(resolveValue(" {{http_1.body}} ", scope).value).toEqual({ items: [{ title: "First" }] });
    expect(resolveValue("{{count}}", scope).value).toBe(3);
    expect(resolveValue("n={{count}}", scope).value).toBe("n=3");
  });
});

describe("transforms", () => {
  it.each([
    ["trim", "  x  ", "", "", "x"],
    ["uppercase", "ab", "", "", "AB"],
    ["truncate", "héllo👋world", "6", "", "héllo👋"],
    ["replace", "a-b-c", "-", "+", "a+b+c"],
    ["split", "a,b", ",", "", ["a", "b"]],
    ["join", ["a", "b"], " & ", "", "a & b"],
    ["join", '["x","y"]', "", "", "x\ny"],
    ["json_parse", '{"a":1}', "", "", { a: 1 }],
    ["json_get", '{"a":{"b":[10,20]}}', "a.b.1", "", 20],
    ["json_get", { a: 1 }, "z", "", null],
  ] as const)("%s", (op, input, arg, rep, expected) => {
    expect(runTransform(op, input, arg, rep)).toEqual(expected);
  });
  it("rejects bad input without executing anything", () => {
    expect(() => runTransform("json_parse", "{nope", "", "")).toThrow("not valid JSON");
    expect(() => runTransform("truncate", "x", "-1", "")).toThrow();
    expect(() => runTransform("join", "not a list", "", "")).toThrow("list");
  });
});

describe("conditions", () => {
  it("evaluates each operator", () => {
    expect(evaluateCondition("equals", " yes ", "yes")).toBe(true);
    expect(evaluateCondition("not_equals", "a", "b")).toBe(true);
    expect(evaluateCondition("contains", "Hello World", "world")).toBe(true);
    expect(evaluateCondition("contains", ["x", "y"], "y")).toBe(true);
    expect(evaluateCondition("greater_than", "10", 9)).toBe(true);
    expect(evaluateCondition("less_than", 1.5, "2")).toBe(true);
    expect(evaluateCondition("exists", "", null)).toBe(false);
    expect(evaluateCondition("exists", [], null)).toBe(false);
    expect(evaluateCondition("exists", 0, null)).toBe(true);
    expect(() => evaluateCondition("greater_than", "abc", 1)).toThrow("non-numbers");
  });
});

describe("input coercion", () => {
  const schema = [
    { name: "topic", type: "text", description: "", required: true, defaultValue: "" },
    { name: "n", type: "number", description: "", required: false, defaultValue: "5" },
    { name: "flag", type: "boolean", description: "", required: false, defaultValue: "" },
    { name: "data", type: "json", description: "", required: false, defaultValue: "" },
  ] as const;
  it("coerces types, applies defaults and drops unknown keys", () => {
    expect(coerceInputs([...schema], { topic: "x", flag: "true", data: '{"k":1}', extra: "drop" })).toEqual({
      values: { topic: "x", n: 5, flag: true, data: { k: 1 } },
      errors: {},
    });
  });
  it("reports missing and malformed values", () => {
    expect(coerceInputs([...schema], { n: "abc", flag: "maybe", data: "{" }).errors).toEqual({
      topic: "Required",
      n: "Must be a number",
      flag: "Must be true or false",
      data: "Must be valid JSON",
    });
  });
});

describe("redaction", () => {
  it("scrubs secret-looking keys, header pairs, token patterns and known secrets", () => {
    const out = redact(
      {
        headers: [{ key: "Authorization", value: "Bearer abc.def.ghi" }, { key: "Accept", value: "json" }],
        apiKey: "whatever",
        note: "key sk-proj-ABCDEFGHIJKLMNOPQRSTUV and Bearer xyz123456789 and my-own-secret-value",
        nested: { password: "hunter2", ok: 1 },
      },
      ["my-own-secret-value"],
    );
    expect(out.headers[0].value).toBe(REDACTED);
    expect(out.headers[1].value).toBe("json");
    expect(out.apiKey).toBe(REDACTED);
    expect(out.nested).toEqual({ password: REDACTED, ok: 1 });
    expect(out.note).not.toMatch(/sk-proj|xyz123456789|my-own-secret-value/);
  });
});
