"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, UploadCloud, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AssetItem } from "./types";

type Job = { key: string; name: string; size: number; progress: number; state: "uploading" | "done" | "error"; error?: string };

const MAX_PARALLEL = 3;

/** Upload one file with progress (fetch has no upload progress, so XHR). */
function uploadOne(file: File, fields: Record<string, string>, onProgress: (p: number) => void): Promise<AssetItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.set("file", file);
    for (const [k, v] of Object.entries(fields)) if (v) form.set(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const body = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return null;
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(body.data);
      else reject(new Error(body?.error?.message ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.open("POST", "/api/assets/upload");
    xhr.send(form);
  });
}

export function useUploader({ collectionId, onUploaded }: { collectionId?: string; onUploaded: (a: AssetItem) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const queue = useRef<{ file: File; key: string }[]>([]);
  const active = useRef(0);

  const pumpRef = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    while (active.current < MAX_PARALLEL && queue.current.length) {
      const { file, key } = queue.current.shift()!;
      active.current++;
      uploadOne(file, { collectionId: collectionId ?? "" }, (p) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, progress: p } : j))))
        .then((asset) => {
          setJobs((js) => js.map((j) => (j.key === key ? { ...j, progress: 1, state: "done" } : j)));
          onUploaded(asset);
        })
        .catch((e: Error) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, state: "error", error: e.message } : j))))
        .finally(() => {
          active.current--;
          pumpRef.current();
        });
    }
  }, [collectionId, onUploaded]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const items = list.map((file) => ({ file, key: `${file.name}-${file.size}-${crypto.randomUUID()}` }));
      setJobs((js) => [...items.map(({ file, key }) => ({ key, name: file.name, size: file.size, progress: 0, state: "uploading" as const })), ...js]);
      queue.current.push(...items);
      pump();
    },
    [pump],
  );

  const clearFinished = () => setJobs((js) => js.filter((j) => j.state === "uploading"));
  return { jobs, add, clearFinished };
}

export function UploadPanel({ jobs, onClear }: { jobs: Job[]; onClear: () => void }) {
  if (jobs.length === 0) return null;
  const busy = jobs.some((j) => j.state === "uploading");
  return (
    <div className="mb-4 rounded-xl border border-border bg-card" aria-live="polite">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium">{busy ? `Uploading ${jobs.filter((j) => j.state === "uploading").length} file(s)…` : "Uploads finished"}</span>
        {!busy && (
          <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Dismiss uploads">
            <X />
          </Button>
        )}
      </div>
      <ul className="max-h-48 divide-y divide-border overflow-y-auto">
        {jobs.map((j) => (
          <li key={j.key} className="flex items-center gap-3 px-4 py-2 text-sm">
            {j.state === "uploading" ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : j.state === "done" ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
            <span className="min-w-0 flex-1 truncate">{j.name}</span>
            {j.state === "error" ? (
              <span className="truncate text-xs text-destructive">{j.error}</span>
            ) : (
              <span className="w-28 shrink-0">
                <span className="block h-1.5 overflow-hidden rounded-full bg-surface">
                  <span className={cn("block h-full rounded-full bg-primary transition-[width]", j.state === "done" && "bg-success")} style={{ width: `${Math.round(j.progress * 100)}%` }} />
                </span>
              </span>
            )}
            <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">{formatBytes(j.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Full-area drop target shown while files are dragged over the library. */
export function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="rounded-2xl border-2 border-dashed border-primary bg-card px-10 py-8 text-center">
        <UploadCloud className="mx-auto mb-2 size-8 text-[var(--ob-accent-2)]" />
        <p className="font-medium">Drop files to upload</p>
      </div>
    </div>
  );
}
