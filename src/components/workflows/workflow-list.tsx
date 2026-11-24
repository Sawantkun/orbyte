"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Copy, Loader2, MoreHorizontal, Search, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ApiClientError, apiFetch } from "@/lib/api-client";

export type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  latestVersion: number;
  updatedAt: string;
};

export function WorkflowList({ initial, initialCursor, query }: { initial: WorkflowRow[]; initialCursor: string | null; query: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState(query);
  const [pending, startTransition] = useTransition();
  const [toDelete, setToDelete] = useState<WorkflowRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Server-rendered results change when the URL query changes: reset during render (no effect needed).
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setItems(initial);
    setCursor(initialCursor);
  }

  // Debounced search → URL (server re-renders with the filtered first page).
  // Only navigate when the query actually differs from the URL; otherwise each
  // navigation's new searchParams object would re-trigger this effect forever.
  useEffect(() => {
    const next = search.trim();
    if (next === query) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (next) params.set("q", next);
      else params.delete("q");
      startTransition(() => router.replace(`/workflows${params.size ? `?${params}` : ""}`));
    }, 250);
    return () => clearTimeout(t);
  }, [search, query, router, searchParams]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor, ...(query ? { q: query } : {}) });
      const { data, meta } = await apiFetch<WorkflowRow[]>(`/api/workflows?${params}`);
      setItems((prev) => [...prev, ...data]);
      setCursor((meta?.nextCursor as string | null) ?? null);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't load more workflows.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function duplicate(w: WorkflowRow) {
    setBusyId(w.id);
    try {
      const { data } = await apiFetch<WorkflowRow>(`/api/workflows/${w.id}/duplicate`, { method: "POST" });
      toast.success(`Duplicated as “${data.name}”`);
      setItems((prev) => [data, ...prev]);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't duplicate the workflow.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    const w = toDelete;
    setToDelete(null);
    if (!w) return;
    setBusyId(w.id);
    try {
      await apiFetch(`/api/workflows/${w.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.id !== w.id));
      toast.success(`Deleted “${w.name}”`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't delete the workflow.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search workflows" aria-label="Search workflows" className="h-8 pl-8" />
        </div>
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Searching" />}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          {query ? (
            <EmptyState icon={Search} title="No matching workflows" description={`Nothing matches “${query}”.`} />
          ) : (
            <EmptyState
              icon={Workflow}
              title="No workflows yet"
              description="Workflows connect inputs, prompts, AI models and outputs into a repeatable process."
              action={
                <Button asChild>
                  <Link href="/workflows/new">Create your first workflow</Link>
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {items.map((w) => (
              <li key={w.id} className="group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-elevated/40">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-elevated text-[var(--ob-accent-2)]">
                  <Workflow className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link href={`/workflows/${w.id}`} className="block truncate text-sm font-medium after:absolute after:inset-0">
                    {w.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{w.description || "No description"}</p>
                </div>
                <div className="hidden w-20 text-right font-mono text-xs text-muted-foreground sm:block">{w.latestVersion > 0 ? `v${w.latestVersion}` : "—"}</div>
                <StatusBadge status={w.status} className="hidden sm:inline-flex" />
                <div className="hidden w-32 text-right text-xs text-muted-foreground md:block">{formatDistanceToNowStrict(new Date(w.updatedAt), { addSuffix: true })}</div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="relative z-10" aria-label={`Actions for ${w.name}`} disabled={busyId === w.id}>
                      {busyId === w.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/workflows/${w.id}`}>Open in Studio</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void duplicate(w)}>
                      <Copy /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(w)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
          {cursor && (
            <div className="border-t border-border p-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore && <Loader2 className="animate-spin" />} Load more
              </Button>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the workflow, all of its versions and its execution history. Assets it generated stay in your library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              Delete workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
