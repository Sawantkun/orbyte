"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ImageUp, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import type { InputField } from "@/lib/workflow/schema";

type Props = { workflowId: string; version: number; open: boolean; onOpenChange: (o: boolean) => void; draftChanged: boolean };

export function RunDialog({ workflowId, version, open, onOpenChange, draftChanged }: Props) {
  const router = useRouter();
  const [fields, setFields] = useState<InputField[] | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  // One key per dialog opening: double-clicks and retries of the same submit create one run.
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<{ inputSchema: InputField[] }>(`/api/workflows/${workflowId}/versions/${version}`)
      .then(({ data }) => {
        if (cancelled) return;
        setFields(data.inputSchema);
        setValues(Object.fromEntries(data.inputSchema.map((f) => [f.name, f.type === "boolean" ? f.defaultValue === "true" : f.defaultValue])));
        setErrors({});
        setLoadError(null);
        setIdempotencyKey(crypto.randomUUID());
      })
      .catch((e) => !cancelled && setLoadError(e instanceof ApiClientError ? e.message : "Couldn't load the inputs."));
    return () => {
      cancelled = true;
    };
  }, [open, workflowId, version]);

  async function submit() {
    setSubmitting(true);
    setErrors({});
    try {
      const { data } = await apiFetch<{ id: string }>(`/api/workflows/${workflowId}/execute`, { method: "POST", body: { inputs: values, idempotencyKey } });
      onOpenChange(false);
      router.push(`/executions/${data.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "INVALID_INPUTS") {
        setErrors((e.details as { fieldErrors?: Record<string, string> })?.fieldErrors ?? {});
      } else {
        toast.error(e instanceof ApiClientError ? e.message : "Couldn't start the run.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run version {version}</DialogTitle>
          <DialogDescription>
            Runs use the published version{draftChanged ? ". Your draft has changes that aren't published yet." : "."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          {loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : fields === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading inputs…
            </p>
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">This workflow has no inputs.</p>
          ) : (
            fields.map((f) => {
              const id = `run-${f.name}`;
              const err = errors[f.name];
              return (
                <div key={f.name} className="space-y-1.5">
                  <Label htmlFor={id} className="flex items-center gap-2">
                    <span className="font-mono text-xs">{f.name}</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {f.type}
                      {f.required ? "" : " · optional"}
                    </span>
                  </Label>
                  {f.type === "image" ? (
                    <ImageField
                      id={id}
                      invalid={!!err}
                      onUploaded={(assetId) => setValues((s) => ({ ...s, [f.name]: assetId }))}
                      onBusy={setUploading}
                    />
                  ) : f.type === "boolean" ? (
                    <Switch id={id} checked={values[f.name] === true} onCheckedChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
                  ) : f.type === "json" || f.type === "text" ? (
                    <Textarea
                      id={id}
                      rows={f.type === "json" ? 4 : 2}
                      className={f.type === "json" ? "font-mono text-xs" : undefined}
                      value={String(values[f.name] ?? "")}
                      aria-invalid={!!err}
                      onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))}
                    />
                  ) : (
                    <Input id={id} inputMode={f.type === "number" ? "decimal" : undefined} value={String(values[f.name] ?? "")} aria-invalid={!!err} onChange={(e) => setValues((s) => ({ ...s, [f.name]: e.target.value }))} />
                  )}
                  {err ? <p className="text-xs text-destructive">{err}</p> : f.description ? <p className="text-xs text-muted-foreground">{f.description}</p> : null}
                </div>
              );
            })
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || uploading || fields === null || !!loadError}>
              {submitting ? <Loader2 className="animate-spin" /> : <Play />} Run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type LibraryImage = { id: string; name: string };

/**
 * An image input: upload a new image (saved to the asset library) or pick one
 * already in the library. The run input is the asset's id.
 */
function ImageField({ id, invalid, onUploaded, onBusy }: { id: string; invalid: boolean; onUploaded: (assetId: string) => void; onBusy: (b: boolean) => void }) {
  const [mode, setMode] = useState<"upload" | "library">("upload");
  const [state, setState] = useState<{ status: "idle" | "uploading" | "done" | "error"; name?: string; preview?: string; message?: string }>({ status: "idle" });
  const [library, setLibrary] = useState<LibraryImage[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => () => {
    if (state.preview?.startsWith("blob:")) URL.revokeObjectURL(state.preview);
  }, [state.preview]);

  useEffect(() => {
    if (mode !== "library" || library) return;
    apiFetch<LibraryImage[]>("/api/assets?kinds=IMAGE&limit=24")
      .then(({ data }) => setLibrary(data))
      .catch(() => setLibrary([]));
  }, [mode, library]);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      setState({ status: "error", message: "Choose an image file (PNG, JPEG, WebP, GIF)." });
      return;
    }
    const preview = URL.createObjectURL(file);
    setState({ status: "uploading", name: file.name, preview });
    setPicked(null);
    onBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("tags", "workflow-input");
      const res = await fetch("/api/assets/upload", { method: "POST", body: form, credentials: "same-origin" });
      const json = (await res.json().catch(() => null)) as { data?: { id: string }; error?: { message?: string } } | null;
      if (!res.ok || !json?.data) throw new Error(json?.error?.message ?? "Upload failed.");
      onUploaded(json.data.id);
      setState({ status: "done", name: file.name, preview });
    } catch (e) {
      onUploaded("");
      setState({ status: "error", name: file.name, preview, message: (e as Error).message });
    } finally {
      onBusy(false);
    }
  }

  function pick(img: LibraryImage) {
    setPicked(img.id);
    onUploaded(img.id);
    setState({ status: "done", name: img.name, preview: `/api/assets/${img.id}/content?variant=thumbnail` });
  }

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Image source" className="inline-flex rounded-md border border-border p-0.5 text-xs">
        {(["upload", "library"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className={mode === m ? "rounded bg-elevated px-2 py-1 text-foreground" : "px-2 py-1 text-muted-foreground hover:text-foreground"}
          >
            {m === "upload" ? "Upload" : "From library"}
          </button>
        ))}
      </div>

      {mode === "upload" ? (
        <div className="flex items-center gap-3">
          {state.preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview
            <img src={state.preview} alt="" className="size-14 shrink-0 rounded-md border border-border object-cover" />
          ) : (
            <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
              <ImageUp className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <Input
              id={id}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              aria-invalid={invalid}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <p className={state.status === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role="status">
              {state.status === "uploading"
                ? "Uploading…"
                : state.status === "done" && !picked
                  ? `Uploaded "${state.name}" to your library`
                  : state.status === "error"
                    ? state.message
                    : "The image is saved to your asset library and passed to the workflow."}
            </p>
          </div>
        </div>
      ) : library === null ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading images…
        </p>
      ) : library.length === 0 ? (
        <p className="text-xs text-muted-foreground">No images in your library yet. Upload one instead.</p>
      ) : (
        <>
          <ul className="grid max-h-48 grid-cols-6 gap-1.5 overflow-y-auto" aria-label="Library images">
            {library.map((img) => (
              <li key={img.id}>
                <button
                  type="button"
                  onClick={() => pick(img)}
                  aria-pressed={picked === img.id}
                  aria-label={img.name}
                  title={img.name}
                  className={picked === img.id ? "block rounded-md ring-2 ring-primary" : "block rounded-md ring-1 ring-border hover:ring-primary/60"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated thumbnail */}
                  <img src={`/api/assets/${img.id}/content?variant=thumbnail`} alt="" className="aspect-square w-full rounded-md object-cover" loading="lazy" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground" role="status">{picked ? `Selected "${state.name}"` : "Choose an image."}</p>
        </>
      )}
    </div>
  );
}
