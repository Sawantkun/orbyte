import type { Metadata } from "next";
import Link from "next/link";
import { Gauge } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CostChart } from "@/components/usage/cost-chart";
import { PRICING_CHECKED_AT } from "@/config/ai-models";
import { formatCount, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/session";
import { getUsageSummary, USAGE_RANGES, type UsageRange } from "@/server/usage";

export const metadata: Metadata = { title: "Usage" };

export default async function UsagePage({ searchParams }: PageProps<"/settings/usage">) {
  const user = await requireUser();
  const { days: raw } = await searchParams;
  const days = (USAGE_RANGES as readonly number[]).includes(Number(raw)) ? (Number(raw) as UsageRange) : 30;
  const s = await getUsageSummary(user.id, days);
  const hasUsage = s.totals.requests > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          AI usage from your workflow runs. Costs are estimates from provider list prices (checked {PRICING_CHECKED_AT}); your provider invoice is authoritative.
        </p>
        <nav aria-label="Range" className="flex rounded-lg border border-border p-0.5">
          {USAGE_RANGES.map((d) => (
            <Link
              key={d}
              href={`/settings/usage?days=${d}`}
              aria-current={d === days ? "page" : undefined}
              className={cn("rounded-md px-2.5 py-1 text-xs", d === days ? "bg-elevated text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {d} days
            </Link>
          ))}
        </nav>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Estimated cost" value={formatUsd(s.totals.costUsd)} hint={s.totals.unpricedRequests ? `${s.totals.unpricedRequests} request(s) without pricing excluded` : undefined} />
        <Tile label="Tokens" value={formatCount(s.totals.inputTokens + s.totals.outputTokens)} hint={`${formatCount(s.totals.inputTokens)} in · ${formatCount(s.totals.outputTokens)} out`} />
        <Tile label="AI requests" value={formatCount(s.totals.requests)} hint={s.totals.images ? `${formatCount(s.totals.images)} images generated` : undefined} />
        <Tile label="Executions" value={formatCount(s.totals.executions)} hint={s.totals.failedExecutions ? `${s.totals.failedExecutions} failed` : undefined} />
      </dl>

      {!hasUsage ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50">
          <EmptyState
            icon={Gauge}
            title={`No AI usage in the last ${days} days`}
            description="Usage is recorded every time an AI Text or AI Image node runs."
          />
        </div>
      ) : (
        <>
          <section aria-label="Cost per day" className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-medium">Estimated cost per day</h2>
            <CostChart data={s.daily} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section aria-label="By model" className="overflow-x-auto rounded-xl border border-border bg-card">
              <h2 className="px-5 pt-4 pb-3 text-sm font-medium">By model</h2>
              <table className="w-full text-sm">
                <thead className="border-y border-border text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 text-right font-medium">Requests</th>
                    <th className="px-3 py-2 text-right font-medium">Tokens</th>
                    <th className="px-5 py-2 text-right font-medium">Est. cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.byModel.map((m) => (
                    <tr key={`${m.provider}/${m.model}`}>
                      <td className="px-5 py-2.5 font-mono text-xs">{m.model}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(m.requests)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(m.inputTokens + m.outputTokens)}</td>
                      <td className="px-5 py-2.5 text-right font-mono text-xs">{m.costUsd !== null ? formatUsd(m.costUsd) : <span className="text-muted-foreground">{m.provider === "claude-cli" ? "subscription" : "no pricing"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section aria-label="By workflow" className="overflow-x-auto rounded-xl border border-border bg-card">
              <h2 className="px-5 pt-4 pb-3 text-sm font-medium">By workflow</h2>
              <table className="w-full text-sm">
                <thead className="border-y border-border text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 font-medium">Workflow</th>
                    <th className="px-3 py-2 text-right font-medium">Runs</th>
                    <th className="px-3 py-2 text-right font-medium">Tokens</th>
                    <th className="px-5 py-2 text-right font-medium">Est. cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.byWorkflow.map((w) => (
                    <tr key={w.workflowId}>
                      <td className="max-w-48 truncate px-5 py-2.5">
                        <Link href={`/workflows/${w.workflowId}`} className="hover:underline">
                          {w.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(w.executions)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(w.tokens)}</td>
                      <td className="px-5 py-2.5 text-right font-mono text-xs">{w.costUsd === null ? "—" : formatUsd(w.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}
