"use client";

import { useState } from "react";
import { BookMarked, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { templateVariables } from "@/lib/workflow/templates";

type Template = { id: string; name: string; description: string | null; content: string; variables: string[] };

/** Load a saved prompt into this node, or save the current one to the user's library. */
export function PromptLibrary({ template, onLoad }: { template: string; onLoad: (t: Template) => void }) {
  const [items, setItems] = useState<Template[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const variables = templateVariables(template);

  async function load() {
    setLoadError(null);
    try {
      setItems((await apiFetch<Template[]>("/api/prompt-templates")).data);
    } catch (e) {
      setLoadError(e instanceof ApiClientError ? e.message : "Couldn't load templates");
    }
  }

  async function save() {
    setSaving(true);
    try {
      await apiFetch("/api/prompt-templates", { method: "POST", body: { name, content: template } });
      toast.success("Saved to your prompt library");
      setSaveOpen(false);
      setName("");
      setItems(null);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Couldn't save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {variables.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {variables.map((v) => (
            <span key={v} className="rounded-md border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {v}
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Popover onOpenChange={(open) => open && void load()}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <BookMarked /> Load from library
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-1">
            {loadError ? (
              <p className="p-3 text-xs text-destructive">{loadError}</p>
            ) : items === null ? (
              <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Loading…
              </p>
            ) : items.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No saved templates yet. Write one and use “Save to library”.</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto">
                {items.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => onLoad(t)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-elevated">
                      <span className="block text-sm">{t.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{t.content}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PopoverContent>
        </Popover>
        <Button type="button" variant="ghost" size="sm" disabled={!template.trim()} onClick={() => setSaveOpen(true)}>
          <Save /> Save to library
        </Button>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save prompt template</DialogTitle>
            <DialogDescription>Reuse this prompt in other workflows. Variables: {variables.join(", ") || "none"}.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="space-y-2"
          >
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || saving}>
                {saving && <Loader2 className="animate-spin" />} Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
