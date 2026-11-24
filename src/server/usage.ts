import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export type UsageSummary = {
  days: UsageRange;
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    images: number;
    /** Sum of priced usage only. */
    costUsd: number;
    /** Requests whose model had no pricing (excluded from costUsd). */
    unpricedRequests: number;
    executions: number;
    failedExecutions: number;
  };
  daily: { date: string; costUsd: number; tokens: number }[];
  byModel: { provider: string; model: string; requests: number; inputTokens: number; outputTokens: number; images: number; costUsd: number | null }[];
  byWorkflow: { workflowId: string; name: string; executions: number; tokens: number; costUsd: number | null }[];
};

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function getUsageSummary(ownerId: string, days: UsageRange, now = new Date()): Promise<UsageSummary> {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(todayUtc - (days - 1) * 86_400_000);

  const [totals, execs, daily, byModel, byWorkflow] = await Promise.all([
    db.$queryRaw<{ requests: bigint; input: bigint | null; output: bigint | null; images: bigint | null; cost: Prisma.Decimal | null; unpriced: bigint }[]>`
      SELECT COUNT(*)::bigint AS requests, SUM("inputTokens")::bigint AS input, SUM("outputTokens")::bigint AS output,
             SUM("imageCount")::bigint AS images, SUM("costUsd") AS cost,
             COUNT(*) FILTER (WHERE "costUsd" IS NULL)::bigint AS unpriced
      FROM usage_record WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${since}`,
    db.$queryRaw<{ total: bigint; failed: bigint }[]>`
      SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed
      FROM workflow_execution WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${since}`,
    db.$queryRaw<{ day: string; cost: Prisma.Decimal | null; tokens: bigint | null }[]>`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, SUM("costUsd") AS cost, SUM("inputTokens" + "outputTokens")::bigint AS tokens
      FROM usage_record WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${since}
      GROUP BY 1`,
    db.$queryRaw<{ provider: string; model: string; requests: bigint; input: bigint; output: bigint; images: bigint; cost: Prisma.Decimal | null }[]>`
      SELECT provider, model, COUNT(*)::bigint AS requests, SUM("inputTokens")::bigint AS input, SUM("outputTokens")::bigint AS output,
             SUM("imageCount")::bigint AS images, SUM("costUsd") AS cost
      FROM usage_record WHERE "ownerId" = ${ownerId} AND "createdAt" >= ${since}
      GROUP BY provider, model ORDER BY SUM("costUsd") DESC NULLS LAST, COUNT(*) DESC LIMIT 20`,
    db.$queryRaw<{ id: string; name: string; executions: bigint; tokens: bigint | null; cost: Prisma.Decimal | null }[]>`
      SELECT w.id, w.name, COUNT(DISTINCT e.id)::bigint AS executions,
             SUM(u."inputTokens" + u."outputTokens")::bigint AS tokens, SUM(u."costUsd") AS cost
      FROM workflow_execution e
      JOIN workflow w ON w.id = e."workflowId"
      LEFT JOIN usage_record u ON u."executionId" = e.id
      WHERE e."ownerId" = ${ownerId} AND e."createdAt" >= ${since}
      GROUP BY w.id, w.name ORDER BY SUM(u."costUsd") DESC NULLS LAST, COUNT(DISTINCT e.id) DESC LIMIT 10`,
  ]);

  const byDay = new Map(daily.map((d) => [d.day, d]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(todayUtc - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(date);
    return { date, costUsd: n(row?.cost), tokens: n(row?.tokens) };
  });

  const t = totals[0];
  return {
    days,
    totals: {
      requests: n(t?.requests),
      inputTokens: n(t?.input),
      outputTokens: n(t?.output),
      images: n(t?.images),
      costUsd: n(t?.cost),
      unpricedRequests: n(t?.unpriced),
      executions: n(execs[0]?.total),
      failedExecutions: n(execs[0]?.failed),
    },
    daily: series,
    byModel: byModel.map((r) => ({ provider: r.provider, model: r.model, requests: n(r.requests), inputTokens: n(r.input), outputTokens: n(r.output), images: n(r.images), costUsd: nOrNull(r.cost) })),
    byWorkflow: byWorkflow.map((r) => ({ workflowId: r.id, name: r.name, executions: n(r.executions), tokens: n(r.tokens), costUsd: nOrNull(r.cost) })),
  };
}
