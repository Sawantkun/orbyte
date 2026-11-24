import "server-only";
import { subDays, startOfDay } from "date-fns";
import type { AssetKind, ExecutionStatus, WorkflowStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { listRecentActivity } from "@/server/activity";
import type { ActivityItem } from "@/lib/activity";

export const ACTIVITY_DAYS = 14;

export type DashboardData = {
  stats: {
    workflows: number;
    executions: number;
    successfulExecutions: number;
    assets: number;
    /** null when no priced usage has been recorded — the UI shows an empty state. */
    estimatedSpendUsd: number | null;
  };
  recentWorkflows: { id: string; name: string; status: WorkflowStatus; updatedAt: string }[];
  recentExecutions: {
    id: string;
    status: ExecutionStatus;
    workflowName: string;
    createdAt: string;
    durationMs: number | null;
  }[];
  recentAssets: { id: string; name: string; kind: AssetKind; createdAt: string }[];
  executionActivity: { date: string; completed: number; failed: number; other: number }[];
  assetDistribution: { kind: AssetKind; count: number }[];
  activity: ActivityItem[];
};

/** `day` is a UTC "YYYY-MM-DD" key (Prisma stores timestamps as UTC without zone). */
type DailyRow = { day: string; status: ExecutionStatus; count: bigint };

/** Build a zero-filled series for the last N UTC days so the chart axis is stable. */
export function buildDailySeries(rows: DailyRow[], days: number, now: Date) {
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const series = new Map<string, { date: string; completed: number; failed: number; other: number }>();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayUtc.getTime() - i * 86_400_000);
    series.set(key(d), { date: key(d), completed: 0, failed: 0, other: 0 });
  }
  for (const row of rows) {
    const bucket = series.get(row.day);
    if (!bucket) continue;
    const n = Number(row.count);
    if (row.status === "COMPLETED") bucket.completed += n;
    else if (row.status === "FAILED") bucket.failed += n;
    else bucket.other += n;
  }
  return [...series.values()];
}

export async function getDashboardData(ownerId: string): Promise<DashboardData> {
  const now = new Date();
  const since = startOfDay(subDays(now, ACTIVITY_DAYS - 1));

  const [
    workflows,
    executions,
    successfulExecutions,
    assets,
    spend,
    recentWorkflows,
    recentExecutions,
    recentAssets,
    daily,
    distribution,
    activity,
  ] = await Promise.all([
    db.workflow.count({ where: { ownerId } }),
    db.workflowExecution.count({ where: { ownerId } }),
    db.workflowExecution.count({ where: { ownerId, status: "COMPLETED" } }),
    db.asset.count({ where: { ownerId } }),
    db.usageRecord.aggregate({ where: { ownerId, costUsd: { not: null } }, _sum: { costUsd: true }, _count: true }),
    db.workflow.findMany({
      where: { ownerId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, name: true, status: true, updatedAt: true },
    }),
    db.workflowExecution.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true, createdAt: true, durationMs: true, workflow: { select: { name: true } } },
    }),
    db.asset.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, name: true, kind: true, createdAt: true },
    }),
    db.$queryRaw<DailyRow[]>`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, status, COUNT(*)::bigint AS count
      FROM workflow_execution
      WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${subDays(since, 1)}
      GROUP BY 1, 2`,
    db.asset.groupBy({ by: ["kind"], where: { ownerId }, _count: { _all: true } }),
    listRecentActivity(ownerId, 8),
  ]);

  return {
    stats: {
      workflows,
      executions,
      successfulExecutions,
      assets,
      estimatedSpendUsd: spend._count > 0 ? Number(spend._sum.costUsd ?? 0) : null,
    },
    recentWorkflows: recentWorkflows.map((w) => ({ ...w, updatedAt: w.updatedAt.toISOString() })),
    recentExecutions: recentExecutions.map((e) => ({
      id: e.id,
      status: e.status,
      workflowName: e.workflow.name,
      createdAt: e.createdAt.toISOString(),
      durationMs: e.durationMs,
    })),
    recentAssets: recentAssets.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    executionActivity: buildDailySeries(daily, ACTIVITY_DAYS, now),
    assetDistribution: distribution
      .map((d) => ({ kind: d.kind, count: d._count._all }))
      .sort((a, b) => b.count - a.count),
    activity,
  };
}
