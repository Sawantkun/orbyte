import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { activityHref, activityLabel, type ActivityItem } from "@/lib/activity";

const toItem = (r: { id: string; action: string; entityType: string; entityId: string | null; metadata: unknown; createdAt: Date }): ActivityItem => ({
  id: r.id,
  action: r.action,
  label: activityLabel(r.action, r.metadata),
  href: activityHref(r.action, r.entityType, r.entityId),
  createdAt: r.createdAt.toISOString(),
});

const select = { id: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true } as const;

export async function listRecentActivity(ownerId: string, take = 10): Promise<ActivityItem[]> {
  const rows = await db.activityLog.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take, select });
  return rows.map(toItem);
}

/** Paginated feed for the activity page. */
export async function listActivity(ownerId: string, q: { cursor?: string; limit: number }): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const rows = await db.activityLog.findMany({
    where: { ownerId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    select,
  });
  const items = rows.slice(0, q.limit).map(toItem);
  return { items, nextCursor: rows.length > q.limit ? items[items.length - 1].id : null };
}

export async function recordActivity(input: {
  ownerId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await db.activityLog.create({ data: input });
}
