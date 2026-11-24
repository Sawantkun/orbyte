"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Play } from "lucide-react";
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
                  {f.type === "boolean" ? (
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
            <Button type="submit" disabled={submitting || fields === null || !!loadError}>
              {submitting ? <Loader2 className="animate-spin" /> : <Play />} Run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
