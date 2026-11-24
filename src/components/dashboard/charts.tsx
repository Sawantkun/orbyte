"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { assetKindLabel, formatDayKey } from "@/lib/format";

type Day = { date: string; completed: number; failed: number; other: number };

const SERIES = [
  { key: "completed", label: "Completed", color: "var(--ob-success)" },
  { key: "failed", label: "Failed", color: "var(--ob-error)" },
  { key: "other", label: "Pending / running / cancelled", color: "#4b5263" },
] as const;

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey?: unknown; value?: unknown }[]; label?: unknown }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-foreground">{formatDayKey(String(label))}</div>
      {SERIES.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value ?? 0;
        return (
          <div key={s.key} className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2 rounded-sm" style={{ background: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="font-mono text-foreground tabular-nums">{String(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ExecutionActivityChart({ data }: { data: Day[] }) {
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: s.color }} /> {s.label}
          </li>
        ))}
      </ul>
      <div className="h-56" role="img" aria-label="Executions per day for the last 14 days, by outcome">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--ob-border)" strokeDasharray="0" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDayKey}
              tick={{ fill: "var(--ob-text-2)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis allowDecimals={false} tick={{ fill: "var(--ob-text-2)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: "var(--ob-elevated)", opacity: 0.6 }} content={<ChartTooltip />} />
            {SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="a"
                fill={s.color}
                stroke="var(--ob-card)"
                strokeWidth={2}
                radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Single-series magnitude by category: a ranked bar list reads better than a pie. */
export function AssetDistribution({ data }: { data: { kind: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.kind} className="group" title={`${assetKindLabel(d.kind)}: ${d.count} (${Math.round((d.count / total) * 100)}%)`}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted-foreground">{assetKindLabel(d.kind)}</span>
            <span className="font-mono text-foreground tabular-nums">{d.count}</span>
          </div>
          <div className="h-2 rounded-full bg-surface">
            <div
              className="h-2 rounded-full bg-primary transition-opacity group-hover:opacity-80"
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
