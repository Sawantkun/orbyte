"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/style.css";
import { AlertCircle, ArrowLeft, Ban, Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { NODE_ICONS } from "@/components/studio/node-icons";
import type { StudioNode } from "@/components/studio/store";
import { StudioNodeComponent } from "@/components/studio/studio-node";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { formatCount, formatDuration, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NODE_SPECS } from "@/lib/workflow/registry";
import { NODE_TYPES, type NodeType } from "@/lib/workflow/schema";
import type { ExecutionDetail, NodeRun } from "@/server/executions";
import { Time } from "@/components/time";

const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, StudioNodeComponent]));
const ACTIVE = new Set(["PENDING", "RUNNING"]);

export function ExecutionDetailView({ initial }: { initial: ExecutionDetail }) {
  const router = useRouter();
  const [exec, setExec] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<"cancel" | "retry" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const active = ACTIVE.has(exec.status);

  // Poll while the run is in flight.
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      try {
        const { data } = await apiFetch<ExecutionDetail>(`/api/executions/${exec.id}`);
        if (!stop) setExec(data);
      } catch {
        /* transient; next tick retries */
      }
    };
    const t = setInterval(() => void tick(), 1200);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active, exec.id]);

  // Latest attempt per node drives the graph colours.
  const latest = useMemo(() => {
    const m = new Map<string, NodeRun>();
    for (const n of exec.nodes) if (!m.has(n.nodeId) || m.get(n.nodeId)!.attempt < n.attempt) m.set(n.nodeId, n);
    return m;
  }, [exec.nodes]);

  const flowNodes: StudioNode[] = useMemo(
    () =>
      exec.definition.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: { ...n.data, runStatus: latest.get(n.id)?.status ?? "PENDING" },
        selected: n.id === selected,
        draggable: false,
        connectable: false,
      })),
    [exec.definition.nodes, latest, selected],
  );
  const flowEdges = useMemo(
    () =>
      exec.definition.edges.map((e) => {
        const src = latest.get(e.source);
        const live = src?.status === "COMPLETED";
        return { id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, animated: src?.status === "RUNNING", style: live ? { stroke: "var(--ob-text-2)" } : undefined };
      }),
    [exec.definition.edges, latest],
  );

  async function cancel() {
    setConfirmCancel(false);
    setBusy("cancel");
    try {
      await apiFetch(`/api/executions/${exec.id}/cancel`, { method: "POST" });
      const { data } = await apiFetch<ExecutionDetail>(`/api/executions/${exec.id}`);
      setExec(data);
      toast.success(data.status === "CANCELLED" ? "Execution cancelled" : "Cancelling…");
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't cancel.");
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    try {
      const { data } = await apiFetch<{ id: string }>(`/api/executions/${exec.id}/retry`, { method: "POST" });
      router.push(`/executions/${data.id}`);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't retry.");
      setBusy(null);
    }
  }

  const selectedNode = selected ? exec.definition.nodes.find((n) => n.id === selected) : null;
  const totalTokens = exec.inputTokens + exec.outputTokens;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/executions" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Executions
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{exec.workflowName}</h1>
              <span className="font-mono text-sm text-muted-foreground">v{exec.version}</span>
              <StatusBadge status={exec.status} />
              {exec.cancelRequested && exec.status === "RUNNING" && <span className="text-xs text-warning">Cancelling…</span>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {exec.trigger === "RETRY" && exec.retryOfId ? (
                <>
                  Retry of{" "}
                  <Link className="underline-offset-2 hover:underline" href={`/executions/${exec.retryOfId}`}>
                    an earlier run
                  </Link>{" "}
                  ·{" "}
                </>
              ) : null}
              Started <Time iso={exec.createdAt} pattern="MMM d, HH:mm:ss" /> ·{" "}
              <Link className="underline-offset-2 hover:underline" href={`/workflows/${exec.workflowId}`}>
                Open workflow
              </Link>
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {active && (
              <Button variant="outline" onClick={() => setConfirmCancel(true)} disabled={busy !== null || exec.cancelRequested}>
                {busy === "cancel" ? <Loader2 className="animate-spin" /> : <Ban />} Cancel
              </Button>
            )}
            {(exec.status === "FAILED" || exec.status === "CANCELLED") && (
              <Button onClick={() => void retry()} disabled={busy !== null}>
                {busy === "retry" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
              </Button>
            )}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Duration" value={active && !exec.durationMs ? "Running…" : formatDuration(exec.durationMs)} />
        <Metric label="Nodes" value={`${[...latest.values()].filter((n) => n.status === "COMPLETED").length} / ${exec.definition.nodes.length} completed`} />
        <Metric label="Tokens" value={totalTokens ? `${formatCount(exec.inputTokens)} in · ${formatCount(exec.outputTokens)} out` : "—"} />
        <Metric label="Est. cost" value={exec.estimatedCostUsd === null ? "—" : formatUsd(exec.estimatedCostUsd)} />
      </dl>

      {exec.error && (
        <div role="alert" className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">{exec.status === "CANCELLED" ? "Cancelled" : "Failed"}</p>
            <p className="mt-0.5 text-foreground/90">{exec.error.message}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{exec.error.code}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <section aria-label="Run graph" className="h-[460px] overflow-hidden rounded-xl border border-border bg-card">
          <ReactFlowProvider>
            <ReactFlow<StudioNode>
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, n) => setSelected(n.id)}
              onPaneClick={() => setSelected(null)}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
              minZoom={0.2}
              attributionPosition="top-right"
              className="orbyte-flow"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--ob-border)" />
              <Controls showInteractive={false} position="bottom-left" />
            </ReactFlow>
          </ReactFlowProvider>
        </section>

        <section aria-label="Details" className="min-w-0 rounded-xl border border-border bg-card">
          {selectedNode ? (
            <NodeDetail
              key={selectedNode.id}
              label={selectedNode.data.label}
              type={selectedNode.type}
              runs={exec.nodes.filter((n) => n.nodeId === selectedNode.id).sort((a, b) => b.attempt - a.attempt)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <div className="space-y-5 p-5">
              <p className="text-xs text-muted-foreground">Select a node to inspect its input, output and logs.</p>
              <JsonBlock title="Inputs" value={exec.input} />
              {exec.status === "COMPLETED" && <JsonBlock title="Outputs" value={exec.output} />}
              <NodeList nodes={exec.definition.nodes.map((n) => ({ id: n.id, label: n.data.label, type: n.type, run: latest.get(n.id) }))} onSelect={setSelected} />
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this execution?</AlertDialogTitle>
            <AlertDialogDescription>Running nodes are stopped and remaining nodes are skipped. You can retry it afterwards.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void cancel()}>
              Cancel execution
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function NodeList({ nodes, onSelect }: { nodes: { id: string; label: string; type: NodeType; run?: NodeRun }[]; onSelect: (id: string) => void }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Nodes</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {nodes.map((n) => {
          const Icon = NODE_ICONS[n.type];
          return (
            <li key={n.id}>
              <button type="button" onClick={() => onSelect(n.id)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-elevated/50">
                <Icon className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{n.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{formatDuration(n.run?.durationMs ?? null)}</span>
                {n.run && <StatusBadge status={n.run.status} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NodeDetail({ label, type, runs, onClose }: { label: string; type: NodeType; runs: NodeRun[]; onClose: () => void }) {
  const [attempt, setAttempt] = useState(runs[0]?.attempt ?? 1);
  const run = runs.find((r) => r.attempt === attempt) ?? runs[0];
  const Icon = NODE_ICONS[type];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
        <Icon className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium">{label}</h2>
          <p className="text-xs text-muted-foreground">{NODE_SPECS[type].label}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      {!run ? (
        <p className="p-5 text-sm text-muted-foreground">This node hasn&apos;t run.</p>
      ) : (
        <div className="space-y-5 overflow-y-auto p-5">
          {runs.length > 1 && (
            <div role="tablist" aria-label="Attempts" className="flex gap-1">
              {[...runs].reverse().map((r) => (
                <button
                  key={r.attempt}
                  role="tab"
                  aria-selected={r.attempt === attempt}
                  onClick={() => setAttempt(r.attempt)}
                  className={cn("rounded-md px-2 py-1 text-xs", r.attempt === attempt ? "bg-elevated text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  Attempt {r.attempt} <span className={r.status === "FAILED" ? "text-destructive" : r.status === "COMPLETED" ? "text-success" : ""}>●</span>
                </button>
              ))}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusBadge status={run.status} />
            </dd>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="font-mono text-xs">{formatDuration(run.durationMs)}</dd>
            {run.inputTokens + run.outputTokens > 0 && (
              <>
                <dt className="text-muted-foreground">Tokens</dt>
                <dd className="font-mono text-xs">
                  {formatCount(run.inputTokens)} in · {formatCount(run.outputTokens)} out
                </dd>
                <dt className="text-muted-foreground">Est. cost</dt>
                <dd className="font-mono text-xs">{run.costUsd === null ? "Unknown pricing" : formatUsd(run.costUsd)}</dd>
              </>
            )}
          </dl>
          {run.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <p className="text-foreground/90">{run.error.message}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{run.error.code}</p>
            </div>
          )}
          {run.input != null && Object.keys(run.input as object).length > 0 && <JsonBlock title="Input" value={run.input} />}
          {run.output != null && <JsonBlock title="Output" value={run.output} />}
          {run.logs.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">Logs</h3>
              <ol className="space-y-1 rounded-lg border border-border bg-background/50 p-3 font-mono text-[11px] leading-relaxed">
                {run.logs.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 text-muted-foreground">{l.ts.slice(11, 23)}</span>
                    <span className={cn("shrink-0 uppercase", l.level === "error" ? "text-destructive" : l.level === "warn" ? "text-warning" : "text-muted-foreground")}>{l.level}</span>
                    <span className="min-w-0 break-all">
                      {l.message}
                      {l.data ? <span className="text-muted-foreground"> {JSON.stringify(l.data)}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        <button
          type="button"
          aria-label={`Copy ${title.toLowerCase()}`}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <pre data-testid={`json-${title.toLowerCase()}`} className="max-h-72 overflow-auto rounded-lg border border-border bg-background/50 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
        {text ?? "null"}
      </pre>
    </div>
  );
}
