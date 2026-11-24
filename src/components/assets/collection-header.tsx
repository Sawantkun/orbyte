"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollectionFormDialog, DeleteCollectionDialog } from "./collection-dialogs";
import type { CollectionItem } from "./types";

export function CollectionHeader({ collection: initial }: { collection: CollectionItem }) {
  const router = useRouter();
  const [collection, setCollection] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="mb-6">
      <Link href="/collections" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3" /> Collections
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{collection.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{collection.description || `${collection.assetCount} asset${collection.assetCount === 1 ? "" : "s"}`}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleting(true)}>
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
      {editing && <CollectionFormDialog open onOpenChange={setEditing} collection={collection} onSaved={(c) => (setCollection(c), router.refresh())} />}
      <DeleteCollectionDialog
        collection={deleting ? collection : null}
        onOpenChange={(o) => !o && setDeleting(false)}
        onDeleted={() => {
          router.push("/collections");
          router.refresh();
        }}
      />
    </div>
  );
}
