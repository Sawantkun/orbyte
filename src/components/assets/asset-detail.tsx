"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, Download, ExternalLink, Loader2, Save, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { assetKindLabel, formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AssetDetail, AssetSummary } from "@/server/assets/service";
import { KindIcon } from "./kind-icon";
import { contentUrl, downloadUrl, thumbUrl, type CollectionItem } from "./types";

const TEXT_PREVIEW_LIMIT = 200_000;

export function AssetDetailView({ initial, related, collections }: { initial: AssetDetail; related: AssetSummary[]; collections: CollectionItem[] }) {
  const router = useRouter();
  const [asset, setAsset] = useState(initial);
  const [form, setForm] = useState({
    name: initial.name,
    description: initial.description ?? "",
    tags: initial.tags.join(", "),
    collectionId: initial.collectionId ?? "none",
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    form.name !== asset.name ||
    form.description !== (asset.description ?? "") ||
    form.tags !== asset.tags.join(", ") ||
    form.collectionId !== (asset.collectionId ?? "none");

  async function save() {
    setSaving(true);
    try {
      const { data } = await apiFetch<AssetDetail>(`/api/assets/${asset.id}`, {
        method: "PATCH",
        body: {
          name: form.name.trim(),
          description: form.description.trim() || null,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
          collectionId: form.collectionId === "none" ? null : form.collectionId,
        },
      });
      setAsset(data);
      setForm({ name: data.name, description: data.description ?? "", tags: data.tags.join(", "), collectionId: data.collectionId ?? "none" });
      toast.success("Saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite() {
    const next = !asset.isFavorite;
    setAsset((a) => ({ ...a, isFavorite: next }));
    try {
      await apiFetch(`/api/assets/${asset.id}`, { method: "PATCH", body: { isFavorite: next } });
    } catch {
      setAsset((a) => ({ ...a, isFavorite: !next }));
      toast.error("Couldn't update favorite.");
    }
  }

  async function remove() {
    try {
      await apiFetch(`/api/assets/${asset.id}`, { method: "DELETE" });
      toast.success(`Deleted “${asset.name}”`);
      router.push(asset.collectionId ? `/collections/${asset.collectionId}` : "/assets");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't delete.");
    }
  }

  const dims = asset.metadata && typeof asset.metadata.width === "number" ? `${asset.metadata.width} × ${asset.metadata.height}` : null;
  const extraMeta = Object.entries(asset.metadata ?? {}).filter(([k]) => !["width", "height"].includes(k));

  return (
    <div className="space-y-6">
      <div>
        <Link href={asset.collection ? `/collections/${asset.collection.id}` : "/assets"} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> {asset.collection ? asset.collection.name : "Assets"}
        </Link>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{asset.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {assetKindLabel(asset.kind)} · {formatBytes(asset.sizeBytes)}
              {dims ? ` · ${dims}` : ""} · Added {format(new Date(asset.createdAt), "MMM d, yyyy")}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="icon" onClick={() => void toggleFavorite()} aria-pressed={asset.isFavorite} aria-label={asset.isFavorite ? "Remove from favorites" : "Add to favorites"}>
              <Star className={cn(asset.isFavorite && "fill-amber-400 text-amber-400")} />
            </Button>
            <Button variant="outline" asChild>
              <a href={downloadUrl(asset.id)} download>
                <Download /> Download
              </a>
            </Button>
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 /> Delete
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section aria-label="Preview" className="flex min-h-80 items-center justify-center overflow-hidden rounded-xl border border-border bg-card">
          <Preview asset={asset} />
        </section>

        <div className="space-y-6">
          <section aria-label="Details" className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div className="space-y-1.5">
              <Label htmlFor="asset-name">Name</Label>
              <Input id="asset-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-desc">Description</Label>
              <Textarea id="asset-desc" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} maxLength={2000} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-tags">Tags</Label>
              <Input id="asset-tags" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="comma, separated" />
            </div>
            <div className="space-y-1.5">
              <Label>Collection</Label>
              <Select value={form.collectionId} onValueChange={(v) => setForm((f) => ({ ...f, collectionId: v }))}>
                <SelectTrigger className="w-full" aria-label="Collection">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No collection</SelectItem>
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void save()} disabled={!dirty || saving || !form.name.trim()}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Save changes
            </Button>
          </section>

          {(asset.source === "WORKFLOW" || asset.originalPrompt) && (
            <section aria-label="Generation" className="space-y-3 rounded-xl border border-border bg-card p-5 text-sm">
              <h2 className="font-medium">Generation</h2>
              {asset.originalPrompt && (
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Prompt</div>
                  <p className="rounded-lg border border-border bg-background/50 p-3 text-sm whitespace-pre-wrap" data-testid="original-prompt">
                    {asset.originalPrompt}
                  </p>
                </div>
              )}
              <dl className="grid grid-cols-[100px_1fr] gap-y-1.5">
                {asset.aiModel && (
                  <>
                    <dt className="text-muted-foreground">Model</dt>
                    <dd className="font-mono text-xs leading-5">
                      {asset.aiProvider} / {asset.aiModel}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">Workflow</dt>
                <dd>
                  {asset.workflowId ? (
                    <Link href={`/workflows/${asset.workflowId}`} className="inline-flex items-center gap-1 hover:underline">
                      {asset.workflowName ?? "Open workflow"} <ExternalLink className="size-3" />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Deleted</span>
                  )}
                </dd>
                {asset.executionId && (
                  <>
                    <dt className="text-muted-foreground">Execution</dt>
                    <dd>
                      <Link href={`/executions/${asset.executionId}`} className="inline-flex items-center gap-1 hover:underline">
                        View run <ExternalLink className="size-3" />
                      </Link>
                    </dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {extraMeta.length > 0 && (
            <section aria-label="Metadata" className="rounded-xl border border-border bg-card p-5 text-sm">
              <h2 className="mb-2 font-medium">Metadata</h2>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1.5">
                {extraMeta.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="truncate text-muted-foreground">{k}</dt>
                    <dd className="truncate font-mono text-xs leading-5">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section aria-label="Related assets">
          <h2 className="mb-3 text-sm font-medium">Related</h2>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {related.map((r) => (
              <li key={r.id}>
                <Link href={`/assets/${r.id}`} className="block overflow-hidden rounded-lg border border-border bg-card hover:border-[color-mix(in_oklab,var(--ob-border),white_14%)]" title={r.name}>
                  <div className="flex aspect-square items-center justify-center bg-surface">
                    {r.hasThumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- authenticated, same-origin thumbnails
                      <img src={thumbUrl(r.id)} alt={r.name} loading="lazy" className="size-full object-cover" />
                    ) : (
                      <KindIcon kind={r.kind} className="size-6 text-muted-foreground" />
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{asset.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The file is permanently removed from storage. This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete asset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Preview({ asset }: { asset: AssetDetail }) {
  const src = contentUrl(asset.id);
  const textLike = asset.mimeType.startsWith("text/") || asset.mimeType === "application/json";
  const [text, setText] = useState<string | null>(null);
  const tooBig = asset.sizeBytes > TEXT_PREVIEW_LIMIT;

  useEffect(() => {
    if (!textLike || tooBig) return;
    const ctrl = new AbortController();
    fetch(src, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (asset.mimeType === "application/json") {
          try {
            return setText(JSON.stringify(JSON.parse(t), null, 2));
          } catch {
            /* show raw */
          }
        }
        setText(t);
      })
      .catch(() => !ctrl.signal.aborted && setText(null));
    return () => ctrl.abort();
  }, [src, textLike, tooBig, asset.mimeType]);

  switch (asset.kind) {
    case "IMAGE":
      // eslint-disable-next-line @next/next/no-img-element -- authenticated, same-origin content
      return <img src={src} alt={asset.name} className="max-h-[70vh] w-auto max-w-full object-contain" />;
    case "VIDEO":
      return <video src={src} controls preload="metadata" className="max-h-[70vh] w-full" />;
    case "AUDIO":
      return <audio src={src} controls className="w-full max-w-md" />;
    case "PDF":
      return <iframe src={src} title={asset.name} className="h-[70vh] w-full" />;
  }
  if (textLike) {
    if (tooBig) return <NoPreview kind={asset.kind} reason="This file is too large to preview. Download it to view." />;
    if (text === null) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;
    return (
      <pre data-testid="text-preview" className="max-h-[70vh] w-full self-stretch overflow-auto p-5 font-mono text-xs leading-relaxed whitespace-pre-wrap">
        {text}
      </pre>
    );
  }
  return <NoPreview kind={asset.kind} reason="No preview for this file type." />;
}

function NoPreview({ kind, reason }: { kind: string; reason: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
      <KindIcon kind={kind} className="size-10" />
      {reason}
    </div>
  );
}
