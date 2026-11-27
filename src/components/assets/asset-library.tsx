"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Check,
  FolderInput,
  FolderMinus,
  LayoutGrid,
  List,
  Loader2,
  Search,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  Upload,
  X,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { assetKindLabel, formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KindIcon } from "./kind-icon";
import { thumbUrl, type AssetItem, type CollectionItem } from "./types";
import { DropOverlay, UploadPanel, useUploader } from "./uploader";
import { Time } from "@/components/time";

const KIND_GROUPS = [
  { value: "", label: "All" },
  { value: "IMAGE", label: "Images" },
  { value: "VIDEO", label: "Video" },
  { value: "AUDIO", label: "Audio" },
  { value: "PDF,DOCUMENT", label: "Documents" },
  { value: "TEXT,JSON,CODE", label: "Text & code" },
  { value: "OTHER", label: "Other" },
] as const;

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name" },
  { value: "size", label: "Largest" },
] as const;

const FILTER_KEYS = ["q", "kinds", "sort", "favorite", "tag", "source", "collectionId", "from", "to"] as const;

export function AssetLibrary({
  collections,
  fixedCollectionId,
  accept,
  autoOpenUpload = false,
}: {
  collections: CollectionItem[];
  fixedCollectionId?: string;
  accept: string;
  autoOpenUpload?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fileInput = useRef<HTMLInputElement>(null);

  const view = params.get("view") === "list" ? "list" : "grid";
  const query = useMemo(() => {
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) p.set(k, v);
    }
    if (fixedCollectionId) p.set("collectionId", fixedCollectionId);
    return p.toString();
  }, [params, fixedCollectionId]);

  const [reload, setReload] = useState(0);
  // Results are tagged with the request they answer; "loading" is derived, not set in an effect.
  const requestKey = `${query}#${reload}`;
  const [data, setData] = useState<{ key: string; items: AssetItem[]; cursor: string | null; error: string | null; search?: string | null }>({ key: "", items: [], cursor: null, error: null });
  const loading = data.key !== requestKey;
  const { items, cursor, error } = data;
  const setItems = (fn: (prev: AssetItem[]) => AssetItem[]) => setData((d) => ({ ...d, items: fn(d.items) }));
  const setCursor = (c: string | null) => setData((d) => ({ ...d, cursor: c }));
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // ── Data ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch<AssetItem[]>(`/api/assets?${query}`, { signal: ctrl.signal })
      .then(({ data, meta }) => {
        setData({ key: requestKey, items: data, cursor: (meta?.nextCursor as string | null) ?? null, error: null, search: (meta?.search as string | null) ?? null });
        setSelected(new Set());
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setData({ key: requestKey, items: [], cursor: null, error: e instanceof ApiClientError ? e.message : "Couldn't load assets." });
      });
    return () => ctrl.abort();
  }, [query, requestKey]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const { data, meta } = await apiFetch<AssetItem[]>(`/api/assets?${query}&cursor=${cursor}`);
      setItems((prev) => [...prev, ...data]);
      setCursor((meta?.nextCursor as string | null) ?? null);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  // ── Uploads (button, drag & drop anywhere) ───────────────────────────────
  const onUploaded = useCallback((a: AssetItem) => setData((d) => ({ ...d, items: d.items.some((x) => x.id === a.id) ? d.items : [a, ...d.items] })), []);
  const { jobs, add, clearFinished } = useUploader({ collectionId: fixedCollectionId, onUploaded });

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) add(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [add]);

  useEffect(() => {
    if (!autoOpenUpload) return;
    toast.info("Drop files anywhere on this page, or use the Upload button.");
  }, [autoOpenUpload]);

  // ── Selection & bulk actions ─────────────────────────────────────────────
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(new Set());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function bulk(op: Record<string, unknown>, success: string) {
    try {
      const { data } = await apiFetch<{ affected: number }>("/api/assets/bulk", { method: "POST", body: { ids: [...selected], op } });
      toast.success(success.replace("{n}", String(data.affected)));
      setReload((r) => r + 1);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't update the selection.");
    }
  }

  async function toggleFavorite(a: AssetItem) {
    setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, isFavorite: !a.isFavorite } : x)));
    try {
      await apiFetch(`/api/assets/${a.id}`, { method: "PATCH", body: { isFavorite: !a.isFavorite } });
    } catch {
      setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, isFavorite: a.isFavorite } : x)));
      toast.error("Couldn't update favorite.");
    }
  }

  const activeFilters = (["favorite", "tag", "source", "collectionId", "from", "to"] as const).filter((k) => params.get(k) && !(k === "collectionId" && fixedCollectionId));
  const collectionName = (id: string | null) => collections.find((c) => c.id === id)?.name;

  return (
    <div>
      <DropOverlay visible={dragging} />
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        data-testid="asset-file-input"
        onChange={(e) => {
          if (e.target.files?.length) add(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox value={params.get("q") ?? ""} onChange={(q) => setParam({ q: q || null })} />
        {!loading && data.search && (
          <span
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            role="status"
            title={data.search === "semantic" ? "Results ranked by meaning as well as words" : "Matching words in names, tags and prompts. Connect OpenAI in Integrations to also search by meaning."}
          >
            {data.search === "semantic" ? <Sparkles className="size-3.5 text-[var(--ob-accent-2)]" /> : null}
            {data.search === "semantic" ? "Smart search" : "Keyword search"}
          </span>
        )}
        <Select value={params.get("sort") ?? "newest"} onValueChange={(v) => setParam({ sort: v === "newest" ? null : v })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FiltersPopover
          params={params}
          setParam={setParam}
          collections={collections}
          hideCollection={!!fixedCollectionId}
          activeCount={activeFilters.length}
        />
        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="View">
            <Button variant="ghost" size="icon-xs" aria-pressed={view === "grid"} aria-label="Grid view" className={cn(view === "grid" && "bg-elevated")} onClick={() => setParam({ view: null })}>
              <LayoutGrid />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-pressed={view === "list"} aria-label="List view" className={cn(view === "list" && "bg-elevated")} onClick={() => setParam({ view: "list" })}>
              <List />
            </Button>
          </div>
          <Button size="sm" onClick={() => fileInput.current?.click()}>
            <Upload /> Upload
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1" role="group" aria-label="File type">
        {KIND_GROUPS.map((k) => {
          const active = (params.get("kinds") ?? "") === k.value;
          return (
            <button
              key={k.label}
              type="button"
              aria-pressed={active}
              onClick={() => setParam({ kinds: k.value || null })}
              className={cn("rounded-lg px-2.5 py-1 text-sm transition-colors", active ? "bg-elevated text-foreground" : "text-muted-foreground hover:bg-elevated/50 hover:text-foreground")}
            >
              {k.label}
            </button>
          );
        })}
        {activeFilters.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setParam({ [k]: null })}
            className="ml-1 inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            aria-label={`Clear ${k} filter`}
          >
            {k === "favorite" ? "Favorites" : k === "collectionId" ? collectionName(params.get(k)) ?? "Collection" : `${k}: ${params.get(k)}`}
            <X className="size-3" />
          </button>
        ))}
      </div>

      <UploadPanel jobs={jobs} onClear={clearFinished} />

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-16 z-20 mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-elevated px-3 py-2 shadow-lg" role="toolbar" aria-label="Selection actions">
          <span className="mr-1 text-sm font-medium">{selected.size} selected</span>
          <Button variant="ghost" size="sm" onClick={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}>
            {allSelected ? "Select none" : "Select all"}
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button variant="ghost" size="sm" onClick={() => void bulk({ action: "favorite", value: true }, "Added {n} to favorites")}>
            <Star /> Favorite
          </Button>
          <TagPopover onApply={(tags, remove) => void bulk({ action: remove ? "removeTags" : "addTags", tags }, remove ? "Removed tags from {n} assets" : "Tagged {n} assets")} />
          <MovePopover collections={collections} exclude={fixedCollectionId} onMove={(id) => void bulk({ action: "move", collectionId: id }, "Moved {n} assets")} />
          {fixedCollectionId && (
            <Button variant="ghost" size="sm" onClick={() => void bulk({ action: "move", collectionId: null }, "Removed {n} assets from this collection")}>
              <FolderMinus /> Remove from collection
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X />
          </Button>
        </div>
      )}

      {/* Content */}
      {error ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-destructive">{error}</div>
      ) : loading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50">
          <EmptyState
            icon={Boxes}
            title={query && query !== (fixedCollectionId ? `collectionId=${fixedCollectionId}` : "") ? "No assets match these filters" : "No assets yet"}
            description="Upload files, or let your workflows save their outputs here automatically. You can also drop files anywhere on this page."
            action={
              <Button onClick={() => fileInput.current?.click()}>
                <Upload /> Upload files
              </Button>
            }
          />
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label="Assets">
          {items.map((a) => (
            <li key={a.id} className={cn("group relative overflow-hidden rounded-xl border bg-card transition-colors", selected.has(a.id) ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-[color-mix(in_oklab,var(--ob-border),white_14%)]")}>
              <Link href={`/assets/${a.id}`} className="block" aria-label={a.name}>
                <div className="flex aspect-[4/3] items-center justify-center bg-surface">
                  {a.hasThumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authenticated, same-origin thumbnails
                    <img src={thumbUrl(a.id)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                  ) : (
                    <KindIcon kind={a.kind} className="size-8 text-muted-foreground" />
                  )}
                </div>
                <div className="px-3 py-2">
                  <div className="truncate text-sm">{a.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {assetKindLabel(a.kind)} · {formatBytes(a.sizeBytes)}
                    {a.source === "WORKFLOW" ? " · generated" : ""}
                  </div>
                </div>
              </Link>
              <SelectBox checked={selected.has(a.id)} onToggle={() => toggle(a.id)} label={a.name} visible={selected.size > 0} />
              <FavoriteButton active={a.isFavorite} onClick={() => void toggleFavorite(a)} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))} className="size-4 accent-[var(--ob-accent)]" />
                </th>
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Tags</th>
                <th className="px-3 py-2.5 font-medium">Source</th>
                <th className="px-3 py-2.5 text-right font-medium">Size</th>
                <th className="px-3 py-2.5 text-right font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((a) => (
                <tr key={a.id} className={cn("hover:bg-elevated/40", selected.has(a.id) && "bg-primary/5")}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Select ${a.name}`} checked={selected.has(a.id)} onChange={() => toggle(a.id)} className="size-4 accent-[var(--ob-accent)]" />
                  </td>
                  <td className="max-w-xs px-3 py-2">
                    <Link href={`/assets/${a.id}`} className="flex items-center gap-2 hover:underline">
                      <KindIcon kind={a.kind} className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{a.name}</span>
                      {a.isFavorite && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{assetKindLabel(a.kind)}</td>
                  <td className="px-3 py-2">
                    <div className="flex max-w-48 flex-wrap gap-1">
                      {a.tags.slice(0, 3).map((t) => (
                        <span key={t} className="rounded bg-elevated px-1.5 text-xs text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="max-w-40 truncate px-3 py-2 text-muted-foreground">{a.workflowName ?? (a.source === "UPLOAD" ? "Upload" : "Workflow")}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{formatBytes(a.sizeBytes)}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground"><Time iso={a.createdAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cursor && !loading && (
        <div className="mt-4 text-center">
          <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore && <Loader2 className="animate-spin" />} Load more
          </Button>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} asset{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>The files are permanently removed from storage. This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void bulk({ action: "delete" }, "Deleted {n} assets")}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setText(value);
  }
  useEffect(() => {
    if (text.trim() === value) return; // only navigate on a real change (avoids refetch loops)
    const t = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search, e.g. purple dashboard images" aria-label="Search assets" className="h-8 pl-8" />
    </div>
  );
}

function SelectBox({ checked, onToggle, label, visible }: { checked: boolean; onToggle: () => void; label: string; visible: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`Select ${label}`}
      onClick={onToggle}
      className={cn(
        "absolute top-2 left-2 flex size-6 items-center justify-center rounded-md border bg-background/80 backdrop-blur transition-opacity focus-visible:opacity-100",
        checked ? "border-primary bg-primary text-white opacity-100" : "border-border opacity-0 group-hover:opacity-100",
        visible && "opacity-100",
      )}
    >
      {checked && <Check className="size-3.5" />}
    </button>
  );
}

function FavoriteButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? "Remove from favorites" : "Add to favorites"}
      className={cn(
        "absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-background/70 backdrop-blur transition-opacity focus-visible:opacity-100",
        active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    >
      <Star className={cn("size-3.5", active ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
    </button>
  );
}

function FiltersPopover({
  params,
  setParam,
  collections,
  hideCollection,
  activeCount,
}: {
  params: URLSearchParams;
  setParam: (p: Record<string, string | null>) => void;
  collections: CollectionItem[];
  hideCollection: boolean;
  activeCount: number;
}) {
  const [tags, setTags] = useState<{ name: string; count: number }[] | null>(null);
  return (
    <Popover onOpenChange={(o) => o && tags === null && void apiFetch<{ name: string; count: number }[]>("/api/tags").then(({ data }) => setTags(data)).catch(() => setTags([]))}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal /> Filters
          {activeCount > 0 && <span className="rounded bg-primary/20 px-1 text-[10px] text-[var(--ob-accent-2)]">{activeCount}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="flt-fav">Favorites only</Label>
          <Switch id="flt-fav" checked={params.get("favorite") === "true"} onCheckedChange={(v) => setParam({ favorite: v ? "true" : null })} />
        </div>
        <div className="space-y-1.5">
          <Label>Source</Label>
          <Select value={params.get("source") ?? "any"} onValueChange={(v) => setParam({ source: v === "any" ? null : v })}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any source</SelectItem>
              <SelectItem value="UPLOAD">Uploaded</SelectItem>
              <SelectItem value="WORKFLOW">Generated by workflows</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!hideCollection && (
          <div className="space-y-1.5">
            <Label>Collection</Label>
            <Select value={params.get("collectionId") ?? "any"} onValueChange={(v) => setParam({ collectionId: v === "any" ? null : v })}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any collection</SelectItem>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Tag</Label>
          <Select value={params.get("tag") ?? "any"} onValueChange={(v) => setParam({ tag: v === "any" ? null : v })}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder={tags === null ? "Loading…" : "Any tag"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any tag</SelectItem>
              {(tags ?? []).map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name} <span className="text-muted-foreground">({t.count})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="flt-from">From</Label>
            <Input id="flt-from" type="date" className="h-8" value={params.get("from") ?? ""} onChange={(e) => setParam({ from: e.target.value || null })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="flt-to">To</Label>
            <Input id="flt-to" type="date" className="h-8" value={params.get("to") ?? ""} onChange={(e) => setParam({ to: e.target.value || null })} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TagPopover({ onApply }: { onApply: (tags: string[], remove: boolean) => void }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const tags = value.split(",").map((t) => t.trim()).filter(Boolean);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Tag /> Tags
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2">
        <Label htmlFor="bulk-tags">Tags (comma-separated)</Label>
        <Input id="bulk-tags" value={value} onChange={(e) => setValue(e.target.value)} placeholder="campaign, q4" className="h-8" />
        <div className="flex gap-2">
          <Button size="sm" disabled={!tags.length} onClick={() => (onApply(tags, false), setOpen(false), setValue(""))}>
            Add
          </Button>
          <Button size="sm" variant="outline" disabled={!tags.length} onClick={() => (onApply(tags, true), setOpen(false), setValue(""))}>
            Remove
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MovePopover({ collections, exclude, onMove }: { collections: CollectionItem[]; exclude?: string; onMove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = collections.filter((c) => c.id !== exclude);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <FolderInput /> Move to…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {options.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">
            No other collections.{" "}
            <Link href="/collections" className="underline">
              Create one
            </Link>
          </p>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {options.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => (onMove(c.id), setOpen(false))} className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-elevated">
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function GridSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-busy="true" aria-label="Loading assets">
      {Array.from({ length: 10 }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="aspect-[4/3] animate-pulse bg-surface" />
          <div className="space-y-1.5 px-3 py-2.5">
            <div className="h-3 w-3/4 animate-pulse rounded bg-elevated" />
            <div className="h-2.5 w-1/2 animate-pulse rounded bg-elevated" />
          </div>
        </li>
      ))}
    </ul>
  );
}
