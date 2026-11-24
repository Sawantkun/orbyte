import { describe, expect, it } from "vitest";
import { NODE_SPECS } from "@/lib/workflow/registry";
import { deriveInputSchema, type NodeType, type WorkflowDefinition, type WorkflowNode } from "@/lib/workflow/schema";
import { starterDefinition } from "@/lib/workflow/starters";
import { availableReferences, validateWorkflow } from "@/lib/workflow/validate";

function n(id: string, type: NodeType, key: string, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { key, label: id, config: { ...NODE_SPECS[type].defaultConfig(), ...config } } };
}
const e = (source: string, target: string, sourceHandle = "out") => ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle, targetHandle: "in" });
const def = (nodes: WorkflowNode[], edges: ReturnType<typeof e>[] = []): WorkflowDefinition => ({ schemaVersion: 1, nodes, edges });
const codes = (d: WorkflowDefinition, severity: "error" | "warning" = "error") =>
  validateWorkflow(d).issues.filter((i) => i.severity === severity).map((i) => i.code);

describe("validateWorkflow", () => {
  it("accepts the starter workflows", () => {
    expect(validateWorkflow(starterDefinition("text"))).toEqual({ valid: true, issues: [] });
    expect(validateWorkflow(starterDefinition("image")).valid).toBe(true);
  });

  it("rejects an empty workflow", () => {
    expect(codes(def([]))).toEqual(["EMPTY"]);
  });

  it("detects cycles", () => {
    const d = def(
      [n("a", "ai_text", "a", { prompt: "x" }), n("b", "ai_text", "b", { prompt: "y" }), n("c", "transform", "c", { input: "z" })],
      [e("a", "b"), e("b", "c"), e("c", "a")],
    );
    const cycle = validateWorkflow(d).issues.filter((i) => i.code === "CYCLE");
    expect(cycle.map((i) => i.nodeId).sort()).toEqual(["a", "b", "c"]);
  });

  it("rejects self loops, dangling edges and bad handles", () => {
    const d = def(
      [n("in", "input", "input_1"), n("t", "ai_text", "t", { prompt: "{{topic}}" }), n("o", "output", "o", { value: "{{t.text}}" })],
      [
        e("in", "t"),
        e("t", "o"),
        { id: "self", source: "t", target: "t", sourceHandle: "out", targetHandle: "in" },
        { id: "gone", source: "t", target: "missing", sourceHandle: "out", targetHandle: "in" },
        { id: "badsrc", source: "t", target: "o", sourceHandle: "true", targetHandle: "in" },
        { id: "intoinput", source: "t", target: "in", sourceHandle: "out", targetHandle: "in" },
      ],
    );
    expect(codes(d)).toEqual(expect.arrayContaining(["SELF_LOOP", "DANGLING_EDGE", "INVALID_HANDLE"]));
    expect(validateWorkflow(d).issues.filter((i) => i.code === "INVALID_HANDLE")).toHaveLength(2);
  });

  it("requires condition edges to use the true/false handles", () => {
    const d = def(
      [n("in", "input", "input_1"), n("c", "condition", "c", { left: "{{topic}}", operator: "exists" }), n("o", "output", "o", { value: "yes" })],
      [e("in", "c"), e("c", "o", "true")],
    );
    expect(validateWorkflow(d).valid).toBe(true);
    const bad = def(d.nodes, [e("in", "c"), e("c", "o", "out")]);
    expect(codes(bad)).toContain("INVALID_HANDLE");
  });

  it("validates template references point upstream and to real fields", () => {
    const base = [n("in", "input", "input_1"), n("t1", "ai_text", "first", { prompt: "{{topic}}" })];
    const ok = def([...base, n("t2", "ai_text", "second", { prompt: "Improve: {{first.text}}" })], [e("in", "t1"), e("t1", "t2")]);
    expect(validateWorkflow(ok).valid).toBe(true);

    const unknown = def([...base, n("t2", "ai_text", "second", { prompt: "{{nope}}" })], [e("in", "t1"), e("t1", "t2")]);
    expect(codes(unknown)).toContain("UNKNOWN_REFERENCE");

    const notUpstream = def([...base, n("t2", "ai_text", "second", { prompt: "{{first.text}}" })], [e("in", "t1")]);
    expect(codes(notUpstream)).toContain("NOT_UPSTREAM");

    const badField = def([...base, n("t2", "ai_text", "second", { prompt: "{{first.images}}" })], [e("in", "t1"), e("t1", "t2")]);
    expect(codes(badField)).toContain("UNKNOWN_FIELD");
  });

  it("flags duplicate keys, invalid keys and duplicate input names", () => {
    const d = def([
      n("a", "input", "input_1", { fieldName: "topic" }),
      n("b", "input", "input_1", { fieldName: "topic" }),
      n("c", "ai_text", "Bad Key", { prompt: "x" }),
    ]);
    expect(codes(d)).toEqual(expect.arrayContaining(["DUPLICATE_KEY", "DUPLICATE_INPUT", "INVALID_KEY"]));
  });

  it("validates per-node config and required fields", () => {
    const d = def([
      n("t", "ai_text", "t", { prompt: "", temperature: 5 }),
      n("m", "ai_text", "m", { prompt: "x", model: "made-up-model" }),
      n("i", "input", "i", { fieldType: "number", defaultValue: "abc" }),
      n("x", "transform", "x", { operation: "truncate", input: "a", argument: "ten" }),
    ]);
    const all = codes(d);
    expect(all).toEqual(expect.arrayContaining(["INVALID_CONFIG", "UNKNOWN_MODEL", "INVALID_DEFAULT", "REQUIRED"]));
  });

  it("blocks unsafe literal URLs in HTTP nodes", () => {
    const mk = (url: string) => def([n("h", "http_request", "h", { url })]);
    expect(codes(mk("http://169.254.169.254/latest/meta-data"))).toContain("UNSAFE_URL");
    expect(codes(mk("http://localhost:3000/api"))).toContain("UNSAFE_URL");
    expect(codes(mk("file:///etc/passwd"))).toContain("UNSAFE_URL");
    expect(codes(mk("https://api.example.com/v1/{{topic}}"))).not.toContain("UNSAFE_URL");
    expect(codes(mk("https://{{host}}/x"), "warning")).toContain("DYNAMIC_HOST");
  });

  it("warns about disconnected nodes and a missing output", () => {
    const d = def([n("in", "input", "input_1"), n("t", "ai_text", "t", { prompt: "hi" })]);
    expect(codes(d, "warning")).toEqual(expect.arrayContaining(["UNUSED_INPUT", "ISOLATED", "NO_OUTPUT"]));
    expect(validateWorkflow(d).valid).toBe(true);
  });

  it("requires output nodes to be connected", () => {
    expect(codes(def([n("o", "output", "o", { value: "x" })]))).toContain("DISCONNECTED_OUTPUT");
  });
});

describe("deriveInputSchema & availableReferences", () => {
  it("derives inputs top-to-bottom", () => {
    const a = n("a", "input", "a", { fieldName: "second" });
    a.position = { x: 0, y: 200 };
    const b = n("b", "input", "b", { fieldName: "first", fieldType: "number", required: false });
    expect(deriveInputSchema(def([a, b])).map((f) => [f.name, f.type, f.required])).toEqual([
      ["first", "number", false],
      ["second", "text", true],
    ]);
  });

  it("lists only upstream references", () => {
    const d = starterDefinition("text");
    expect(availableReferences(d, "n_text").map((r) => r.ref)).toEqual(["{{topic}}", "{{prompt_1.text}}"]);
    expect(availableReferences(d, "n_input")).toEqual([]);
  });
});
