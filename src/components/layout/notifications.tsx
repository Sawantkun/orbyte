"use client";

import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActivityItem } from "@/lib/activity";

/** Shows the user's latest activity log entries. */
export function Notifications({ items }: { items: ActivityItem[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Recent activity">
          <Bell className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Recent activity</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          items.map((item) => (
            <DropdownMenuItem key={item.id} className="flex-col items-start gap-0.5" asChild>
              <Link href="/dashboard#activity">
                <span className="text-sm">{item.label}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })}
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
