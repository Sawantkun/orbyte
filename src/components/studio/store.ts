"use client";

import { createContext, useContext } from "react";
import { createStore, useStore } from "zustand";
import type { Connection, Edge, EdgeChangeset, Node, NodeChangeset, XYPosition } from "@xyflow/react";
import { NODE_SPECS, nextNodeKey } from "@/lib/workflow/registry";
import { WORKFLOW_SCHEMA_VERSION, type NodeType, type WorkflowDefinition } from "@/lib/workflow/schema";

/** React Flow node carrying our stored node data unchanged. */
export type StudioNodeData = {
  key: string;
  label: string;
  config: Record<string, unknown>;
  /** Display-only: set when rendering an execution's graph. Never saved. */
  runStatus?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";
};
export type StudioNode = Node<StudioNodeData, NodeType>;
export type StudioEdge = Edge;

type Snapshot = { nodes: StudioNode[]; edges: StudioEdge[] };

export type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export type StudioState = {
  nodes: StudioNode[];
  edges: StudioEdge[];
  name: string;
  description: string;
  /** Server `updatedAt` of the last saved state (optimistic concurrency token). */
  updatedAt: string;
  saveState: SaveState;
  /** Monotonic counter bumped on every content change; lets autosave detect edits made during a save. */
  revision: number;
  past: Snapshot[];
  future: Snapshot[];
  /** Coalesces rapid edits to the same thing (e.g. typing in a field) into one undo step. */
  lastCommitTag: { tag: string; at: number } | null;

  onNodesChange: (changes: NodeChangeset<StudioNode>) => void;
  onEdgesChange: (changes: EdgeChangeset<StudioEdge>) => void;
  connect: (c: Connection) => void;
  addNode: (type: NodeType, position: XYPosition) => string;
  updateNode: (id: string, patch: Partial<StudioNodeData>) => void;
  updateConfig: (id: string, patch: Record<string, unknown>) => void;
  duplicateNodes: (ids: string[]) => void;
  deleteSelection: () => void;
  selectOnly: (id: string | null) => void;
  setMeta: (patch: { name?: string; description?: string }) => void;
  commit: (tag?: string) => void;
  undo: () => void;
  redo: () => void;
  loadDefinition: (def: WorkflowDefinition) => void;
  markSaving: () => void;
  markSaved: (updatedAt: string, savedRevision: number) => void;
  markSaveFailed: (state: "error" | "conflict") => void;
  toDefinition: () => WorkflowDefinition;
};

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1000;

const clean = (nodes: StudioNode[], edges: StudioEdge[]): Snapshot => ({
  nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
  edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({ id, source, target, sourceHandle, targetHandle })),
});

export function toFlow(def: WorkflowDefinition): Snapshot {
  return {
    nodes: def.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data as StudioNodeData })),
    edges: def.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
  };
}

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

/** True if adding source→target would create a cycle (target already reaches source). */
export function createsCycle(edges: StudioEdge[], source: string, target: string): boolean {
  if (source === target) return true;
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(out.get(cur) ?? []));
  }
  return false;
}

export function createStudioStore(init: { definition: WorkflowDefinition; name: string; description: string; updatedAt: string }) {
  const flow = toFlow(init.definition);

  return createStore<StudioState>()((set, get) => {
    /** Content changed: bump revision and mark dirty. */
    const touched = () => ({ revision: get().revision + 1, saveState: "dirty" as SaveState });

    return {
      ...flow,
      name: init.name,
      description: init.description,
      updatedAt: init.updatedAt,
      saveState: "saved",
      revision: 0,
      past: [],
      future: [],
      lastCommitTag: null,

      commit: (tag) => {
        const { nodes, edges, past, lastCommitTag } = get();
        const now = Date.now();
        if (tag && lastCommitTag?.tag === tag && now - lastCommitTag.at < COALESCE_MS) {
          set({ lastCommitTag: { tag, at: now } });
          return;
        }
        set({
          past: [...past, clean(nodes, edges)].slice(-HISTORY_LIMIT),
          future: [],
          lastCommitTag: tag ? { tag, at: now } : null,
        });
      },

      undo: () => {
        const { past, future, nodes, edges } = get();
        const prev = past.at(-1);
        if (!prev) return;
        set({ ...prev, past: past.slice(0, -1), future: [clean(nodes, edges), ...future], lastCommitTag: null, ...touched() });
      },

      redo: () => {
        const { past, future, nodes, edges } = get();
        const next = future[0];
        if (!next) return;
        set({ ...next, past: [...past, clean(nodes, edges)], future: future.slice(1), lastCommitTag: null, ...touched() });
      },

      onNodesChange: (changes) => {
        const list = changes.toArray();
        // Selection and measurement changes are view state, not content.
        const isContent = list.some((c) => c.type === "position" || c.type === "remove" || c.type === "add" || c.type === "replace");
        set({ nodes: changes.applyTo(get().nodes), ...(isContent ? touched() : {}) });
      },

      onEdgesChange: (changes) => {
        const isContent = changes.toArray().some((c) => c.type !== "select");
        set({ edges: changes.applyTo(get().edges), ...(isContent ? touched() : {}) });
      },

      connect: (c) => {
        if (!c.source || !c.target) return;
        const { edges } = get();
        if (createsCycle(edges, c.source, c.target)) return;
        if (edges.some((e) => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))) return;
        get().commit();
        const edge: StudioEdge = {
          id: newId("e"),
          source: c.source,
          target: c.target,
          sourceHandle: c.sourceHandle ?? null,
          targetHandle: c.targetHandle ?? "in",
        };
        set({ edges: [...edges, edge], ...touched() });
      },

      addNode: (type, position) => {
        get().commit();
        const spec = NODE_SPECS[type];
        const keys = get().nodes.map((n) => n.data.key);
        const key = nextNodeKey(spec.keyPrefix, keys);
        const config = spec.defaultConfig() as Record<string, unknown>;
        if (type === "input") {
          const taken = new Set(get().nodes.filter((n) => n.type === "input").map((n) => n.data.config.fieldName));
          let i = 1;
          let fieldName = "topic";
          while (taken.has(fieldName)) fieldName = `field_${i++}`;
          config.fieldName = fieldName;
        }
        if (type === "output") {
          const taken = new Set(get().nodes.filter((n) => n.type === "output").map((n) => n.data.config.name));
          let i = 1;
          let name = "result";
          while (taken.has(name)) name = `result_${++i}`;
          config.name = name;
        }
        const id = newId("n");
        const node: StudioNode = { id, type, position, data: { key, label: spec.label, config }, selected: true };
        set({ nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), node], ...touched() });
        return id;
      },

      updateNode: (id, patch) => {
        get().commit(`node:${id}:${Object.keys(patch).join(",")}`);
        set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), ...touched() });
      },

      updateConfig: (id, patch) => {
        get().commit(`config:${id}:${Object.keys(patch).join(",")}`);
        set({
          nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } } : n)),
          ...touched(),
        });
      },

      duplicateNodes: (ids) => {
        const { nodes, edges } = get();
        const sources = nodes.filter((n) => ids.includes(n.id));
        if (sources.length === 0) return;
        get().commit();
        const keys = nodes.map((n) => n.data.key);
        const idMap = new Map<string, string>();
        const copies = sources.map((n) => {
          const id = newId("n");
          idMap.set(n.id, id);
          const key = nextNodeKey(NODE_SPECS[n.type!].keyPrefix, keys);
          keys.push(key);
          const config = structuredClone(n.data.config);
          if (n.type === "input") config.fieldName = `${config.fieldName}_copy`.slice(0, 40);
          if (n.type === "output") config.name = `${config.name}_copy`.slice(0, 40);
          return { id, type: n.type, position: { x: n.position.x + 40, y: n.position.y + 40 }, data: { ...n.data, key, label: `${n.data.label} copy`, config }, selected: true } as StudioNode;
        });
        // Keep connections between duplicated nodes.
        const copiedEdges = edges
          .filter((e) => idMap.has(e.source) && idMap.has(e.target))
          .map((e) => ({ ...e, id: newId("e"), source: idMap.get(e.source)!, target: idMap.get(e.target)!, selected: false }));
        set({
          nodes: [...nodes.map((n) => ({ ...n, selected: false })), ...copies],
          edges: [...edges, ...copiedEdges],
          ...touched(),
        });
      },

      deleteSelection: () => {
        const { nodes, edges } = get();
        const doomed = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
        const selectedEdges = edges.filter((e) => e.selected);
        if (doomed.size === 0 && selectedEdges.length === 0) return;
        get().commit();
        set({
          nodes: nodes.filter((n) => !doomed.has(n.id)),
          edges: edges.filter((e) => !e.selected && !doomed.has(e.source) && !doomed.has(e.target)),
          ...touched(),
        });
      },

      selectOnly: (id) => {
        set({
          nodes: get().nodes.map((n) => (n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })),
          edges: get().edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
        });
      },

      setMeta: (patch) => set({ ...patch, ...touched() }),

      loadDefinition: (def) => {
        get().commit();
        set({ ...toFlow(def), ...touched() });
      },

      markSaving: () => set({ saveState: "saving" }),
      markSaved: (updatedAt, savedRevision) =>
        set({ updatedAt, saveState: get().revision === savedRevision ? "saved" : "dirty" }),
      markSaveFailed: (state) => set({ saveState: state }),

      toDefinition: () => {
        const { nodes, edges } = clean(get().nodes, get().edges);
        return {
          schemaVersion: WORKFLOW_SCHEMA_VERSION,
          nodes: nodes.map((n) => ({ id: n.id, type: n.type!, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data })),
          edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
        };
      },
    };
  });
}

export type StudioStore = ReturnType<typeof createStudioStore>;
export const StudioStoreContext = createContext<StudioStore | null>(null);

export function useStudio<T>(selector: (s: StudioState) => T): T {
  const store = useContext(StudioStoreContext);
  if (!store) throw new Error("useStudio must be used inside <StudioStoreContext>");
  return useStore(store, selector);
}

export function useStudioApi(): StudioStore {
  const store = useContext(StudioStoreContext);
  if (!store) throw new Error("useStudioApi must be used inside <StudioStoreContext>");
  return store;
}
