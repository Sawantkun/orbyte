"use client";

import { NODE_CATEGORIES, NODE_SPECS } from "@/lib/workflow/registry";
import { NODE_TYPES, type NodeType } from "@/lib/workflow/schema";
import { cn } from "@/lib/utils";
import { NODE_ICONS, NODE_TONES } from "./node-icons";

export const DRAG_MIME = "application/x-orbyte-node";

export function Palette({ onAdd }: { onAdd: (type: NodeType) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Nodes</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Drag onto the canvas or click to add.</p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {NODE_CATEGORIES.map((category) => (
          <div key={category}>
            <div className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">{category}</div>
            <div className="space-y-1">
              {NODE_TYPES.filter((t) => NODE_SPECS[t].category === category).map((type) => {
                const spec = NODE_SPECS[type];
                const Icon = NODE_ICONS[type];
                return (
                  <button
                    key={type}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, type);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onAdd(type)}
                    aria-label={`Add ${spec.label} node`}
                    className="group flex w-full cursor-grab items-start gap-2.5 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-elevated/60 active:cursor-grabbing"
                  >
                    <span className={cn("mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg", NODE_TONES[type])}>
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{spec.label}</span>
                      <span className="block text-xs leading-snug text-muted-foreground">{spec.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
