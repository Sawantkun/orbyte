import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { activityLabel, type ActivityItem } from "@/lib/activity";

export async function listRecentActivity(ownerId: string, take = 10): Promise<ActivityItem[]> {
  const rows = await db.activityLog.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, metadata: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    label: activityLabel(r.action, r.metadata),
    createdAt: r.createdAt.toISOString(),
  }));
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
