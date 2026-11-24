import type { Metadata } from "next";
import { ActivityFeed } from "@/components/activity-feed";
import { PageHeader } from "@/components/layout/page-header";
import { listActivity } from "@/server/activity";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  const user = await requireUser();
  const { items, nextCursor } = await listActivity(user.id, { limit: 50 });
  return (
    <>
      <PageHeader title="Activity" description="Everything that happened in your workspace." />
      <ActivityFeed initial={items} initialCursor={nextCursor} />
    </>
  );
}
