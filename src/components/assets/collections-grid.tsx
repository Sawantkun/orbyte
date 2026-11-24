"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { FolderKanban, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { CollectionFormDialog, DeleteCollectionDialog } from "./collection-dialogs";
import { thumbUrl, type CollectionItem } from "./types";

export function CollectionsGrid({ initial }: { initial: CollectionItem[] }) {
  const [items, setItems] = useState(initial);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CollectionItem | null>(null);
  const [deleting, setDeleting] = useState<CollectionItem | null>(null);
  const q = search.trim().toLowerCase();
  const visible = q ? items.filter((c) => c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)) : items;

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search collections" aria-label="Search collections" className="h-8 pl-8" />
        </div>
        <Button className="ml-auto" size="sm" onClick={() => setCreating(true)}>
          <Plus /> New collection
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50">
          <EmptyState
            icon={FolderKanban}
            title={q ? "No matching collections" : "No collections yet"}
            description={q ? undefined : "Collections group assets, such as a campaign, a client project or product images."}
            action={!q && <Button onClick={() => setCreating(true)}>Create a collection</Button>}
          />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Collections">
          {visible.map((c) => (
            <li key={c.id} className="group relative overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-[color-mix(in_oklab,var(--ob-border),white_14%)]">
              <Link href={`/collections/${c.id}`} className="block" aria-label={c.name}>
                <div className="flex aspect-[16/9] items-center justify-center bg-surface">
                  {c.coverAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authenticated, same-origin thumbnails
                    <img src={thumbUrl(c.coverAssetId)} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <FolderKanban className="size-8 text-muted-foreground" />
                  )}
                </div>
                <div className="px-4 py-3">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.assetCount} asset{c.assetCount === 1 ? "" : "s"} · updated {formatDistanceToNowStrict(new Date(c.updatedAt), { addSuffix: true })}
                  </div>
                </div>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon-sm" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`Actions for ${c.name}`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(c)}>
                    <Pencil /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      {creating && <CollectionFormDialog open onOpenChange={setCreating} onSaved={(c) => setItems((prev) => [c, ...prev])} />}
      {editing && (
        <CollectionFormDialog open onOpenChange={(o) => !o && setEditing(null)} collection={editing} onSaved={(c) => setItems((prev) => prev.map((x) => (x.id === c.id ? c : x)))} />
      )}
      <DeleteCollectionDialog collection={deleting} onOpenChange={(o) => !o && setDeleting(null)} onDeleted={(id) => (setItems((prev) => prev.filter((x) => x.id !== id)), setDeleting(null))} />
    </>
  );
}
