"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, History } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Time } from "@/components/time";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import type { StudioNode } from "./store";

type NodeStatus = NonNullable<StudioNode["data"]["runStatus"]>;
type Detail = { id: string; status: string; version: number; createdAt: string } & { nodes: { nodeId: string; status: NodeStatus; attempt: number }[] };

const RunStatusContext = createContext<Map<string, NodeStatus> | null>(null);

/** Status of a node in the workflow's latest run, when the overlay is on. */
export function useNodeRunStatus(nodeId: string): NodeStatus | undefined {
  return useContext(RunStatusContext)?.get(nodeId);
}

const ACTIVE = new Set(["PENDING", "RUNNING"]);

/**
 * Loads the workflow's most recent run and overlays each node's status on the
 * canvas (polling while it's still going). Nodes added since that run stay plain.
 */
export function LastRunProvider({ workflowId, children }: { workflowId: string; children: (bar: React.ReactNode) => React.ReactNode }) {
  const [run, setRun] = useState<Detail | null>(null);
  const [show, setShow] = useState(true);

  // Bumped to re-fetch (polling while the run is still going).
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await apiFetch<{ id: string }[]>(`/api/executions?workflowId=${encodeURIComponent(workflowId)}&limit=1`);
      const detail = data[0] ? (await apiFetch<Detail>(`/api/executions/${data[0].id}`)).data : null;
      if (!cancelled) setRun(detail);
    })().catch(() => {
      /* the overlay is optional; ignore failures */
    });
    return () => {
      cancelled = true;
    };
  }, [workflowId, tick]);

  const active = run !== null && ACTIVE.has(run.status);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setTick((n) => n + 1), 1500);
    return () => clearTimeout(t);
  }, [active, run]);

  const statuses = useMemo(() => {
    if (!run || !show) return null;
    const m = new Map<string, NodeStatus>();
    for (const n of run.nodes) m.set(n.nodeId, n.status); // attempts are ordered, so the latest wins
    return m;
  }, [run, show]);

  const bar = run ? (
    <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card/90 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur" role="status" aria-label="Last run">
      <History className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">Last run</span>
      <StatusBadge status={run.status} />
      <span className="hidden text-muted-foreground sm:inline">
        v{run.version} · <Time iso={run.createdAt} />
      </span>
      <Button variant="ghost" size="icon-sm" className="size-6" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? "Hide run status on canvas" : "Show run status on canvas"}>
        {show ? <Eye /> : <EyeOff />}
      </Button>
      <Link href={`/executions/${run.id}`} className="text-[var(--ob-accent-2)] hover:underline">
        Open
      </Link>
    </div>
  ) : null;

  return <RunStatusContext.Provider value={statuses}>{children(bar)}</RunStatusContext.Provider>;
}
