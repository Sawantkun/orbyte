import type { Metadata } from "next";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Activity,
  ArrowUpRight,
  Blocks,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  FolderPlus,
  Play,
  Plus,
  Settings,
  Upload,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { AssetDistribution, ExecutionActivityChart } from "@/components/dashboard/charts";
import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/status-badge";
import { assetKindLabel, formatCount, formatDuration, formatUsd } from "@/lib/format";
import { getDashboardData } from "@/server/dashboard";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Overview" };

const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true });

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);
  const firstName = user.name.split(/\s+/)[0] || user.name;
  const { stats } = data;
  const successRate = stats.executions > 0 ? Math.round((stats.successfulExecutions / stats.executions) * 100) : null;
  const hasExecutions = data.executionActivity.some((d) => d.completed + d.failed + d.other > 0);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Here's what's happening across your workflows and assets."
        actions={
          <>
            <LinkButton href="/workflows" variant="outline">
              Browse workflows
            </LinkButton>
            <LinkButton href="/assets?upload=1" variant="outline">
              <Upload /> Upload asset
            </LinkButton>
            <LinkButton href="/workflows/new">
              <Plus /> Create workflow
            </LinkButton>
          </>
        }
      />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard icon={Workflow} label="Workflows" value={formatCount(stats.workflows)} />
        <StatCard icon={Play} label="Executions" value={formatCount(stats.executions)} />
        <StatCard
          icon={CheckCircle2}
          label="Successful"
          value={formatCount(stats.successfulExecutions)}
          hint={successRate === null ? "No runs yet" : `${successRate}% success rate`}
        />
        <StatCard icon={Boxes} label="Assets" value={formatCount(stats.assets)} />
        <StatCard
          icon={CircleDollarSign}
          label="Est. AI spend"
          value={stats.estimatedSpendUsd === null ? "—" : formatUsd(stats.estimatedSpendUsd)}
          hint={stats.estimatedSpendUsd === null ? "No priced usage recorded" : "All time"}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel title="Execution activity" description="Last 14 days (UTC)" href="/executions" className="lg:col-span-2">
          {hasExecutions ? (
            <ExecutionActivityChart data={data.executionActivity} />
          ) : (
            <EmptyState icon={Activity} title="No executions yet" description="Runs will chart here once you execute a workflow." />
          )}
        </Panel>

        <Panel title="Asset distribution" description="By file type" href="/assets">
          {data.assetDistribution.length > 0 ? (
            <AssetDistribution data={data.assetDistribution} />
          ) : (
            <EmptyState icon={Boxes} title="No assets yet" description="Uploads and workflow outputs are broken down here." />
          )}
        </Panel>

        <Panel title="Recent workflows" href="/workflows">
          {data.recentWorkflows.length > 0 ? (
            <ul className="divide-y divide-border">
              {data.recentWorkflows.map((w) => (
                <Row key={w.id} href={`/workflows/${w.id}`} primary={w.name} secondary={`Edited ${ago(w.updatedAt)}`} trailing={<StatusBadge status={w.status} />} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={Workflow} title="No workflows yet" description="Build your first AI workflow in the Studio." />
          )}
        </Panel>

        <Panel title="Recent executions" href="/executions">
          {data.recentExecutions.length > 0 ? (
            <ul className="divide-y divide-border">
              {data.recentExecutions.map((e) => (
                <Row
                  key={e.id}
                  href={`/executions/${e.id}`}
                  primary={e.workflowName}
                  secondary={`${ago(e.createdAt)} · ${formatDuration(e.durationMs)}`}
                  trailing={<StatusBadge status={e.status} />}
                />
              ))}
            </ul>
          ) : (
            <EmptyState icon={Play} title="No executions yet" description="Execution history and logs appear here." />
          )}
        </Panel>

        <Panel title="Recently generated assets" href="/assets">
          {data.recentAssets.length > 0 ? (
            <ul className="divide-y divide-border">
              {data.recentAssets.map((a) => (
                <Row key={a.id} href={`/assets/${a.id}`} primary={a.name} secondary={`${assetKindLabel(a.kind)} · ${ago(a.createdAt)}`} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={Boxes} title="No assets yet" description="Workflow outputs are saved here automatically." />
          )}
        </Panel>

        <Panel title="Quick actions">
          <div className="grid grid-cols-2 gap-2">
            <QuickAction icon={Plus} label="New workflow" href="/workflows/new" />
            <QuickAction icon={Upload} label="Upload asset" href="/assets?upload=1" />
            <QuickAction icon={FolderPlus} label="New collection" href="/collections" />
            <QuickAction icon={Blocks} label="Connect provider" href="/integrations" />
            <QuickAction icon={Settings} label="Account settings" href="/settings/profile" />
          </div>
        </Panel>

        <Panel title="Recent activity" id="activity" href="/activity" className="lg:col-span-2">
          {data.activity.length > 0 ? (
            <ol className="relative space-y-4 border-l border-border pl-5">
              {data.activity.map((item) => (
                <li key={item.id} className="relative">
                  <span className="absolute top-1.5 -left-[24.5px] size-2 rounded-full border-2 border-card bg-primary" aria-hidden />
                  {item.href ? (
                    <Link href={item.href} className="text-sm hover:underline">
                      {item.label}
                    </Link>
                  ) : (
                    <p className="text-sm">{item.label}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{ago(item.createdAt)}</p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={Activity} title="No activity yet" />
          )}
        </Panel>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 ${className ?? ""}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Panel({
  title,
  description,
  href,
  id,
  className,
  children,
}: {
  title: string;
  description?: string;
  href?: string;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className={`flex flex-col rounded-xl border border-border bg-card ${className ?? ""}`}>
      <header className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {href && (
          <Link href={href} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            View all <ArrowUpRight className="size-3" />
          </Link>
        )}
      </header>
      <div className="flex-1 px-5 pb-5">{children}</div>
    </section>
  );
}

function Row({ href, primary, secondary, trailing }: { href: string; primary: string; secondary: string; trailing?: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-elevated/50">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{primary}</span>
          <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
        </span>
        {trailing}
      </Link>
    </li>
  );
}

function QuickAction({ icon: Icon, label, href }: { icon: LucideIcon; label: string; href: string }) {
  return (
    <LinkButton href={href} variant="outline" className="h-auto w-full flex-col items-start gap-2 p-3 text-left font-normal">
      <Icon className="size-4 text-[var(--ob-accent-2)]" />
      <span className="text-xs">{label}</span>
    </LinkButton>
  );
}
