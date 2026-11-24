"use client";

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CloudOff,
  History,
  Loader2,
  PanelLeft,
  PanelRight,
  Play,
  Redo2,
  Rocket,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { useStudio } from "./store";
import { useValidation } from "./validation-context";

export type VersionInfo = { id: string; version: number; createdAt: string; nodeCount: number };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

function SaveIndicator({ onRetry }: { onRetry: () => void }) {
  const state = useStudio((s) => s.saveState);
  const map = {
    saved: { icon: Check, text: "Saved", cls: "text-muted-foreground" },
    dirty: { icon: null, text: "Unsaved changes", cls: "text-muted-foreground" },
    saving: { icon: Loader2, text: "Saving…", cls: "text-muted-foreground" },
    error: { icon: CloudOff, text: "Save failed — retry", cls: "text-destructive" },
    conflict: { icon: AlertCircle, text: "Changed elsewhere — reload", cls: "text-warning" },
  } as const;
  const { icon: Icon, text, cls } = map[state];
  const clickable = state === "error" || state === "conflict";
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={state === "conflict" ? () => window.location.reload() : onRetry}
      className={cn("hidden items-center gap-1.5 text-xs sm:inline-flex", cls, clickable && "underline-offset-2 hover:underline")}
      aria-live="polite"
      data-testid="save-state"
    >
      {Icon && <Icon className={cn("size-3.5", state === "saving" && "animate-spin")} />} {text}
    </button>
  );
}

export function Toolbar({
  status,
  latestVersion,
  versions,
  publishing,
  onSave,
  onPublish,
  onRestore,
  onTogglePalette,
  onToggleInspector,
}: {
  status: string;
  latestVersion: number;
  versions: VersionInfo[];
  publishing: boolean;
  onSave: () => void;
  onPublish: () => void;
  onRestore: (v: VersionInfo) => void;
  onTogglePalette: () => void;
  onToggleInspector: () => void;
}) {
  const name = useStudio((s) => s.name);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const { issues, valid } = useValidation();
  const errors = issues.filter((i) => i.severity === "error").length;

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <Button variant="ghost" size="icon-sm" asChild aria-label="Back to workflows">
        <Link href="/workflows">
          <ArrowLeft />
        </Link>
      </Button>
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onTogglePalette} aria-label="Show nodes">
        <PanelLeft />
      </Button>
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-sm font-medium" title={name}>
          {name || "Untitled workflow"}
        </h1>
        <StatusBadge status={status} className="hidden md:inline-flex" />
        {latestVersion > 0 && <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">v{latestVersion}</span>}
      </div>
      <SaveIndicator onRetry={onSave} />

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!canUndo} aria-label="Undo">
              <Undo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo ({mod}Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!canRedo} aria-label="Redo">
              <Redo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo ({isMac ? "⇧⌘Z" : "Ctrl+Y"})</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Version history">
              <History /> <span className="hidden md:inline">Versions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Published versions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {versions.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">Nothing published yet.</p>
            ) : (
              versions.map((v) => (
                <DropdownMenuItem key={v.id} onSelect={() => onRestore(v)} className="flex-col items-start gap-0">
                  <span className="text-sm">
                    Version {v.version} <span className="text-xs text-muted-foreground">· {v.nodeCount} nodes</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNowStrict(new Date(v.createdAt), { addSuffix: true })} · restore to draft
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="hidden rounded-lg sm:inline-flex">
              <Button variant="outline" size="sm" disabled aria-disabled>
                <Play /> Run
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Execution arrives in Milestone 3</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" onClick={onPublish} disabled={publishing} aria-label="Publish">
              {publishing ? <Loader2 className="animate-spin" /> : <Rocket />}
              <span className="hidden sm:inline">Publish</span>
              {!valid && <span className="ml-0.5 rounded bg-white/20 px-1 text-[10px]">{errors}</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{valid ? "Snapshot this draft as a new version" : `${errors} error(s) to fix before publishing`}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onToggleInspector} aria-label="Show inspector">
          <PanelRight />
        </Button>
      </div>
    </div>
  );
}
