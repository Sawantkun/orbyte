import { describe, expect, it } from "vitest";
import { createStudioStore, createsCycle } from "@/components/studio/store";
import { starterDefinition } from "@/lib/workflow/starters";
import { validateWorkflow } from "@/lib/workflow/validate";

const make = () =>
  createStudioStore({ definition: starterDefinition("text"), name: "T", description: "", updatedAt: "2026-01-01T00:00:00.000Z" });

describe("studio store", () => {
  it("round-trips the definition unchanged", () => {
    const s = make();
    expect(s.getState().toDefinition()).toEqual(starterDefinition("text"));
    expect(s.getState().saveState).toBe("saved");
  });

  it("adds nodes with unique keys and input names, and marks dirty", () => {
    const s = make();
    s.getState().addNode("input", { x: 0, y: 300 });
    s.getState().addNode("ai_text", { x: 0, y: 400 });
    const nodes = s.getState().nodes;
    expect(nodes.map((n) => n.data.key)).toEqual(["input_1", "prompt_1", "text_1", "output_1", "input_2", "text_2"]);
    expect(nodes[4].data.config.fieldName).not.toBe("topic");
    expect(s.getState().saveState).toBe("dirty");
    expect(s.getState().revision).toBe(2);
  });

  it("undoes and redoes structural edits", () => {
    const s = make();
    const id = s.getState().addNode("transform", { x: 0, y: 0 });
    s.getState().connect({ source: "n_text", target: id, sourceHandle: "out", targetHandle: "in" });
    expect(s.getState().edges).toHaveLength(4);
    s.getState().undo();
    expect(s.getState().edges).toHaveLength(3);
    s.getState().undo();
    expect(s.getState().nodes).toHaveLength(4);
    s.getState().redo();
    s.getState().redo();
    expect(s.getState().nodes).toHaveLength(5);
    expect(s.getState().edges).toHaveLength(4);
  });

  it("coalesces rapid edits to the same field into one undo step", () => {
    const s = make();
    for (const v of ["a", "ab", "abc"]) s.getState().updateConfig("n_text", { prompt: v });
    expect(s.getState().past).toHaveLength(1);
    s.getState().undo();
    expect(s.getState().nodes.find((n) => n.id === "n_text")!.data.config.prompt).toBe("{{prompt_1.text}}");
  });

  it("refuses connections that would create a cycle or duplicate an edge", () => {
    const s = make();
    s.getState().connect({ source: "n_output", target: "n_input", sourceHandle: "out", targetHandle: "in" }); // output → input is cyclic
    s.getState().connect({ source: "n_text", target: "n_prompt", sourceHandle: "out", targetHandle: "in" });
    s.getState().connect({ source: "n_input", target: "n_prompt", sourceHandle: "out", targetHandle: "in" }); // duplicate
    expect(s.getState().edges).toHaveLength(3);
    expect(createsCycle(s.getState().edges, "n_output", "n_input")).toBe(true);
    expect(createsCycle(s.getState().edges, "n_input", "n_output")).toBe(false);
  });

  it("duplicates a selection with internal edges and fresh keys, staying valid", () => {
    const s = make();
    s.getState().duplicateNodes(["n_prompt", "n_text"]);
    const st = s.getState();
    expect(st.nodes).toHaveLength(6);
    expect(st.edges).toHaveLength(4); // prompt→text copied, external edges not
    const def = st.toDefinition();
    expect(new Set(def.nodes.map((n) => n.data.key)).size).toBe(6);
    // The copied text node still references the original prompt (not upstream) → caught by validation.
    expect(validateWorkflow(def).issues.some((i) => i.code === "NOT_UPSTREAM")).toBe(true);
  });

  it("deletes selected nodes and their edges", () => {
    const s = make();
    s.getState().selectOnly("n_prompt");
    s.getState().deleteSelection();
    expect(s.getState().nodes.map((n) => n.id)).toEqual(["n_input", "n_text", "n_output"]);
    expect(s.getState().edges.map((e) => e.id)).toEqual(["e3"]);
  });

  it("tracks edits made while a save is in flight", () => {
    const s = make();
    s.getState().updateNode("n_text", { label: "x" });
    const rev = s.getState().revision;
    s.getState().markSaving();
    s.getState().updateNode("n_text", { label: "xy" });
    s.getState().markSaved("2026-01-02T00:00:00.000Z", rev);
    expect(s.getState().saveState).toBe("dirty");
    expect(s.getState().updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });
});
