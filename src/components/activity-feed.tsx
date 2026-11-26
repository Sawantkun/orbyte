"use client";

import Link from "next/link";
import { useState } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Time, useHydrated } from "@/components/time";
import { Button } from "@/components/ui/button";
import type { ActivityItem } from "@/lib/activity";
import { apiFetch } from "@/lib/api-client";

const localDayLabel = (iso: string) => {
  const d = new Date(iso);
  return isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEEE, MMM d");
};
/** Before hydration, group by UTC date so server and client markup match. */
const utcDayLabel = (iso: string) => iso.slice(0, 10);

export function ActivityFeed({ initial, initialCursor }: { initial: ActivityItem[]; initialCursor: string | null }) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const hydrated = useHydrated();
  const dayLabel = hydrated ? localDayLabel : utcDayLabel;

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const { data, meta } = await apiFetch<ActivityItem[]>(`/api/activity?cursor=${cursor}`);
      setItems((p) => [...p, ...data]);
      setCursor((meta?.nextCursor as string | null) ?? null);
    } catch {
      toast.error("Couldn't load more activity.");
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <EmptyState icon={Activity} title="No activity yet" />
      </div>
    );
  }

  const groups: { day: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.createdAt);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(item);
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.day} aria-label={g.day}>
          <h2 className="mb-2 text-xs font-medium text-muted-foreground">{g.day}</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {g.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                {i.href ? (
                  <Link href={i.href} className="min-w-0 flex-1 truncate hover:underline">
                    {i.label}
                  </Link>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{i.label}</span>
                )}
                <Time iso={i.createdAt} pattern="HH:mm" className="shrink-0 font-mono text-xs text-muted-foreground" />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {cursor && (
        <div className="text-center">
          <Button variant="outline" size="sm" onClick={() => void more()} disabled={loading}>
            {loading && <Loader2 className="animate-spin" />} Load more
          </Button>
        </div>
      )}
    </div>
  );
}
