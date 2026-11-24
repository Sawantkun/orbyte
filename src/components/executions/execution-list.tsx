"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { formatCount, formatDuration, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExecutionSummary } from "@/server/executions";

const FILTERS = [
  { value: "", label: "All" },
  { value: "RUNNING", label: "Running" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

export function ExecutionList({ initial, initialCursor, status }: { initial: ExecutionSummary[]; initialCursor: string | null; status: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setItems(initial);
    setCursor(initialCursor);
  }

  // Keep in-flight runs fresh without a manual reload.
  const active = items.some((e) => e.status === "PENDING" || e.status === "RUNNING");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [active, router]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor, ...(status ? { status } : {}) });
      const { data, meta } = await apiFetch<ExecutionSummary[]>(`/api/executions?${params}`);
      setItems((prev) => [...prev, ...data]);
      setCursor((meta?.nextCursor as string | null) ?? null);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't load more executions.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `${pathname}?status=${f.value}` : pathname}
            aria-current={status === f.value ? "page" : undefined}
            className={cn(
              "rounded-lg px-2.5 py-1 text-sm transition-colors",
              status === f.value ? "bg-elevated text-foreground" : "text-muted-foreground hover:bg-elevated/50 hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={Play}
            title={status ? "No executions with this status" : "No executions yet"}
            description="Publish a workflow and press Run in the Studio. Every run, with its per-node logs, shows up here."
            action={
              !status && (
                <Button variant="outline" asChild>
                  <Link href="/workflows">Go to workflows</Link>
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Workflow</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Started</th>
                <th className="px-4 py-2.5 text-right font-medium">Duration</th>
                <th className="px-4 py-2.5 text-right font-medium">Tokens</th>
                <th className="px-4 py-2.5 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((e) => (
                <tr key={e.id} className="group relative transition-colors hover:bg-elevated/40">
                  <td className="px-4 py-3">
                    <Link href={`/executions/${e.id}`} className="font-medium after:absolute after:inset-0">
                      {e.workflowName}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">v{e.version}</span>
                    {e.trigger === "RETRY" && <span className="ml-2 text-xs text-muted-foreground">retry</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDistanceToNowStrict(new Date(e.createdAt), { addSuffix: true })}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{formatDuration(e.durationMs)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{e.inputTokens + e.outputTokens > 0 ? formatCount(e.inputTokens + e.outputTokens) : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{e.estimatedCostUsd === null ? "—" : formatUsd(e.estimatedCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && (
            <div className="border-t border-border p-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore && <Loader2 className="animate-spin" />} Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
