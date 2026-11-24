"use client";

import { useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { AlertCircle, AlertTriangle, CheckCircle2, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NODE_SPECS } from "@/lib/workflow/registry";
import { availableReferences, type ValidationIssue } from "@/lib/workflow/validate";
import { cn } from "@/lib/utils";
import { TextAreaInput, TextInput } from "./fields";
import { NODE_ICONS, NODE_TONES } from "./node-icons";
import { NodeConfigForm } from "./node-config";
import { useStudio, useStudioApi } from "./store";
import { useValidation } from "./validation-context";

export function Inspector() {
  const selected = useStudio((s) => {
    const sel = s.nodes.filter((n) => n.selected);
    return sel.length === 1 ? sel[0] : null;
  });
  return selected ? <NodeInspector nodeId={selected.id} /> : <WorkflowInspector />;
}

function NodeInspector({ nodeId }: { nodeId: string }) {
  const node = useStudio((s) => s.nodes.find((n) => n.id === nodeId)!);
  const nodes = useStudio((s) => s.nodes);
  const edges = useStudio((s) => s.edges);
  const api = useStudioApi();
  const { issues } = useValidation();
  const nodeIssues = issues.filter((i) => i.nodeId === nodeId);
  const spec = NODE_SPECS[node.type!];
  const Icon = NODE_ICONS[node.type!];

  const references = useMemo(
    () =>
      availableReferences(
        {
          schemaVersion: 1,
          nodes: nodes.map((n) => ({ id: n.id, type: n.type!, position: n.position, data: n.data })),
          edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
        },
        nodeId,
      ),
    [nodes, edges, nodeId],
  );

  const keyIssue = nodeIssues.find((i) => i.field === "key");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className={cn("inline-flex size-7 items-center justify-center rounded-lg", NODE_TONES[node.type!])}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{spec.label}</h2>
          <p className="truncate text-xs text-muted-foreground">{spec.description}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Duplicate node" title="Duplicate (⌘D)" onClick={() => api.getState().duplicateNodes([nodeId])}>
          <Copy />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete node" title="Delete (⌫)" onClick={() => api.getState().deleteSelection()}>
          <Trash2 />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4" data-testid="inspector">
        <div className="grid grid-cols-2 gap-2">
          <TextInput label="Label" value={node.data.label} onChange={(v) => api.getState().updateNode(nodeId, { label: v })} />
          <TextInput
            label="Key"
            mono
            value={node.data.key}
            onChange={(v) => api.getState().updateNode(nodeId, { key: v.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) })}
            error={keyIssue?.message.replace(/^[^:]+: /, "")}
          />
        </div>
        {spec.outputFields.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Downstream nodes can use{" "}
            {spec.outputFields.map((f, i) => (
              <span key={f}>
                {i > 0 && ", "}
                <code className="font-mono text-[var(--ob-accent-2)]">{`{{${node.data.key}.${f}}}`}</code>
              </span>
            ))}
            .
          </p>
        )}
        <div className="h-px bg-border" />
        <NodeConfigForm
          type={node.type!}
          config={node.data.config}
          onChange={(patch) => api.getState().updateConfig(nodeId, patch)}
          references={references}
          issues={nodeIssues}
        />
        {nodeIssues.filter((i) => !i.field || i.field === "key").length > 0 && (
          <IssueList issues={nodeIssues.filter((i) => !i.field)} />
        )}
      </div>
    </div>
  );
}

function WorkflowInspector() {
  const name = useStudio((s) => s.name);
  const description = useStudio((s) => s.description);
  const api = useStudioApi();
  const { issues, valid } = useValidation();
  const { fitView } = useReactFlow();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Workflow</h2>
        <p className="text-xs text-muted-foreground">Select a node to configure it.</p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <TextInput label="Name" value={name} onChange={(v) => api.getState().setMeta({ name: v })} error={name.trim() ? undefined : "Name is required"} />
        <TextAreaInput label="Description" value={description} onChange={(v) => api.getState().setMeta({ description: v })} />
        <div className="h-px bg-border" />
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-medium text-muted-foreground">Validation</h3>
            {valid ? (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="size-3.5" /> Ready to publish
              </span>
            ) : (
              <span className="text-xs text-destructive">{issues.filter((i) => i.severity === "error").length} error(s)</span>
            )}
          </div>
          {issues.length === 0 ? (
            <p className="text-xs text-muted-foreground">No issues found.</p>
          ) : (
            <IssueList
              issues={issues}
              onSelect={(i) => {
                if (!i.nodeId) return;
                api.getState().selectOnly(i.nodeId);
                void fitView({ nodes: [{ id: i.nodeId }], duration: 300, maxZoom: 1.2 });
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function IssueList({ issues, onSelect }: { issues: ValidationIssue[]; onSelect?: (i: ValidationIssue) => void }) {
  return (
    <ul className="space-y-1.5" aria-label="Validation issues">
      {issues.map((i, idx) => {
        const Icon = i.severity === "error" ? AlertCircle : AlertTriangle;
        const content = (
          <>
            <Icon className={cn("mt-0.5 size-3.5 shrink-0", i.severity === "error" ? "text-destructive" : "text-warning")} />
            <span className="text-xs leading-snug">{i.message}</span>
          </>
        );
        return (
          <li key={`${i.code}-${i.nodeId ?? i.edgeId ?? ""}-${idx}`}>
            {onSelect && i.nodeId ? (
              <button type="button" onClick={() => onSelect(i)} className="flex w-full gap-2 rounded-md p-1.5 text-left hover:bg-elevated">
                {content}
              </button>
            ) : (
              <div className="flex gap-2 p-1.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
