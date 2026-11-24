"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import type { CollectionItem } from "./types";

/** Create (no `collection`) or edit an existing collection. */
export function CollectionFormDialog({
  open,
  onOpenChange,
  collection,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  collection?: CollectionItem;
  onSaved: (c: CollectionItem) => void;
}) {
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { data } = collection
        ? await apiFetch<CollectionItem>(`/api/collections/${collection.id}`, { method: "PATCH", body: { name: name.trim(), description: description.trim() || null } })
        : await apiFetch<CollectionItem>("/api/collections", { method: "POST", body: { name: name.trim(), description: description.trim() || undefined } });
      onSaved(data);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't save the collection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{collection ? "Edit collection" : "New collection"}</DialogTitle>
          <DialogDescription>Group related assets, such as a campaign, a client or a website.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="col-name">Name</Label>
            <Input id="col-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="col-desc">Description (optional)</Label>
            <Textarea id="col-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {busy && <Loader2 className="animate-spin" />} {collection ? "Save" : "Create collection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteCollectionDialog({
  collection,
  onOpenChange,
  onDeleted,
}: {
  collection: CollectionItem | null;
  onOpenChange: (o: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  async function remove() {
    if (!collection) return;
    try {
      await apiFetch(`/api/collections/${collection.id}`, { method: "DELETE" });
      toast.success(`Deleted “${collection.name}”. Its assets are still in your library.`);
      onDeleted(collection.id);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't delete the collection.");
    }
  }
  return (
    <AlertDialog open={collection !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{collection?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Only the collection is deleted. Its {collection?.assetCount ?? 0} asset{collection?.assetCount === 1 ? "" : "s"} stay in your library.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void remove()}>
            Delete collection
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
