"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatDayKey, formatUsd } from "@/lib/format";

type Day = { date: string; costUsd: number; tokens: number };

function Tip({ active, payload, label }: { active?: boolean; payload?: { payload?: Day }[]; label?: unknown }) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return (
    <div className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium">{formatDayKey(String(label))}</div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        Est. cost <span className="font-mono text-foreground">{formatUsd(d.costUsd)}</span>
      </div>
      <div className="flex justify-between gap-4 text-muted-foreground">
        Tokens <span className="font-mono text-foreground">{formatCount(d.tokens)}</span>
      </div>
    </div>
  );
}

/** Tick labels with enough precision to stay distinct at small scales ($0.0025 vs $0.0050). */
export function costTick(v: number, max: number): string {
  if (v === 0) return "$0";
  const decimals = max < 0.01 ? 4 : max < 1 ? 3 : max < 10 ? 2 : 0;
  return `$${v.toFixed(decimals)}`;
}

export function CostChart({ data }: { data: Day[] }) {
  const max = Math.max(...data.map((d) => d.costUsd), 0);
  return (
    <div className="h-56" role="img" aria-label="Estimated cost per day">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -8 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--ob-border)" />
          <XAxis dataKey="date" tickFormatter={formatDayKey} tick={{ fill: "var(--ob-text-2)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis tickFormatter={(v: number) => costTick(v, max)} tick={{ fill: "var(--ob-text-2)", fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
          <Tooltip cursor={{ fill: "var(--ob-elevated)", opacity: 0.6 }} content={<Tip />} />
          <Bar dataKey="costUsd" fill="var(--ob-accent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
