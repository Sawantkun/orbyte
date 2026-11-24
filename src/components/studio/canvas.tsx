"use client";

import { useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/style.css";
import { NODE_SPECS } from "@/lib/workflow/registry";
import { NODE_TYPES, type NodeType } from "@/lib/workflow/schema";
import { DRAG_MIME } from "./palette";
import { createsCycle, useStudio, useStudioApi, type StudioNode } from "./store";
import { StudioNodeComponent } from "./studio-node";

const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, StudioNodeComponent]));

const MINIMAP_COLORS: Record<string, string> = {
  input: "#38bdf8",
  condition: "#f59e0b",
  transform: "#2dd4bf",
  http_request: "#2dd4bf",
  output: "#22c55e",
};

export function Canvas() {
  const nodes = useStudio((s) => s.nodes);
  const edges = useStudio((s) => s.edges);
  const onNodesChange = useStudio((s) => s.onNodesChange);
  const onEdgesChange = useStudio((s) => s.onEdgesChange);
  const connect = useStudio((s) => s.connect);
  const api = useStudioApi();
  const { screenToFlowPosition } = useReactFlow();

  const isValidConnection: IsValidConnection = useCallback(
    (c: Edge | Connection) => {
      if (!c.source || !c.target || c.source === c.target) return false;
      const { nodes: ns, edges: es } = api.getState();
      const target = ns.find((n) => n.id === c.target);
      if (!target || !NODE_SPECS[target.type as NodeType].hasInput) return false;
      return !createsCycle(es, c.source, c.target);
    },
    [api],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const type = e.dataTransfer.getData(DRAG_MIME) as NodeType;
      if (!NODE_TYPES.includes(type)) return;
      e.preventDefault();
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      api.getState().addNode(type, { x: p.x - 120, y: p.y - 30 });
    },
    [api, screenToFlowPosition],
  );

  const defaultEdgeOptions = useMemo(() => ({ style: { strokeWidth: 1.5 } }), []);

  return (
    <ReactFlow<StudioNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={connect}
      isValidConnection={isValidConnection}
      onNodeDragStart={() => api.getState().commit()}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={onDrop}
      // Deletion goes through the store so it is recorded in undo history.
      deleteKeyCode={null}
      defaultEdgeOptions={defaultEdgeOptions}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={2}
      snapToGrid
      snapGrid={[10, 10]}
      attributionPosition="top-right"
      className="orbyte-flow"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--ob-border)" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        nodeColor={(n) => MINIMAP_COLORS[n.type ?? ""] ?? "#8b5cf6"}
        nodeBorderRadius={6}
        maskColor="rgb(11 12 16 / 0.7)"
        className="!rounded-lg !border !border-border !bg-card"
      />
    </ReactFlow>
  );
}
