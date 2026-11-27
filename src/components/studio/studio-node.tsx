"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertCircle, CheckCircle2, CircleDashed, Loader2, MinusCircle, XCircle } from "lucide-react";
import { NODE_SPECS } from "@/lib/workflow/registry";
import { cn } from "@/lib/utils";
import { NODE_ICONS, NODE_TONES } from "./node-icons";
import { nodeSummary } from "./node-summary";
import type { StudioNode } from "./store";
import { useNodeIssues } from "./validation-context";
import { useNodeRunStatus } from "./last-run";

const RUN_STYLES = {
  PENDING: { icon: CircleDashed, ring: "border-border opacity-70", text: "text-muted-foreground" },
  RUNNING: { icon: Loader2, ring: "border-primary ring-2 ring-primary/30", text: "text-[var(--ob-accent-2)]" },
  COMPLETED: { icon: CheckCircle2, ring: "border-success/60", text: "text-success" },
  FAILED: { icon: XCircle, ring: "border-destructive ring-2 ring-destructive/25", text: "text-destructive" },
  SKIPPED: { icon: MinusCircle, ring: "border-dashed border-border opacity-50", text: "text-muted-foreground" },
} as const;

const handleClass =
  "!size-2.5 !border-2 !border-[var(--ob-card)] !bg-[var(--ob-text-2)] transition-colors hover:!bg-[var(--ob-accent)]";

function StudioNodeView({ id, type, data, selected }: NodeProps<StudioNode>) {
  const spec = NODE_SPECS[type];
  const Icon = NODE_ICONS[type];
  const issues = useNodeIssues(id);
  const errors = issues.filter((i) => i.severity === "error").length;
  const lastRun = useNodeRunStatus(id);
  const runStatus = data.runStatus ?? lastRun;
  const run = runStatus ? RUN_STYLES[runStatus] : null;
  const RunIcon = run?.icon;

  return (
    <div
      data-testid={`node-${data.key}`}
      className={cn(
        "w-56 rounded-xl border bg-card shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset,0_8px_24px_-12px_rgb(0_0_0/0.6)] transition-[border-color,box-shadow]",
        run
          ? cn(run.ring, selected && "outline-2 outline-offset-2 outline-primary")
          : selected
            ? "border-primary ring-2 ring-primary/25"
            : "border-border hover:border-[color-mix(in_oklab,var(--ob-border),white_14%)]",
        !run && errors > 0 && !selected && "border-destructive/50",
      )}
    >
      {spec.hasInput && <Handle type="target" position={Position.Left} id="in" className={handleClass} />}

      <div className="flex items-center gap-2.5 px-3 pt-3">
        <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg", NODE_TONES[type])}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] leading-tight font-medium">{data.label || spec.label}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{data.key}</div>
        </div>
        {RunIcon && (
          <span className={cn("inline-flex", run.text)} title={runStatus} aria-label={`Status: ${runStatus}`}>
            <RunIcon className={cn("size-4", runStatus === "RUNNING" && "animate-spin")} />
          </span>
        )}
        {!run && errors > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive" title={`${errors} issue(s)`}>
            <AlertCircle className="size-3" /> {errors}
          </span>
        )}
      </div>
      <div className="truncate px-3 pt-2 pb-3 text-xs text-muted-foreground">{nodeSummary(type, data.config)}</div>

      {spec.outputs.length === 1 && <Handle type="source" position={Position.Right} id={spec.outputs[0]} className={handleClass} />}
      {spec.outputs.length === 2 &&
        spec.outputs.map((h, i) => (
          <div key={h} className="absolute right-0 flex translate-x-full items-center" style={{ top: `${i === 0 ? 34 : 66}%` }}>
            <Handle type="source" position={Position.Right} id={h} className={cn(handleClass, "!relative !top-auto !right-auto !translate-x-[-50%] !translate-y-0")} />
            <span className={cn("ml-0.5 text-[10px] font-medium", h === "true" ? "text-success" : "text-destructive")}>{h}</span>
          </div>
        ))}
    </div>
  );
}

export const StudioNodeComponent = memo(StudioNodeView);
