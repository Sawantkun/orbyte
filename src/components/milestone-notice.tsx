import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Honest placeholder for routes whose feature ships in a later milestone.
 * Deliberately has no controls that look functional.
 */
export function MilestoneNotice({
  icon: Icon,
  title,
  milestone,
  description,
  capabilities,
}: {
  icon: LucideIcon;
  title: string;
  milestone: number;
  description: string;
  capabilities: string[];
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 sm:p-12">
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div className="mb-4 inline-flex size-11 items-center justify-center rounded-xl border border-border bg-elevated text-[var(--ob-accent-2)]">
          <Icon className="size-5" />
        </div>
        <Badge variant="outline" className="mb-3 text-muted-foreground">
          Coming in Milestone {milestone}
        </Badge>
        <h2 className="text-lg font-semibold tracking-tight">{title} isn&apos;t available yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <ul className="mt-6 grid w-full gap-2 text-left text-sm sm:grid-cols-2">
          {capabilities.map((c) => (
            <li key={c} className="rounded-lg border border-border bg-background/40 px-3 py-2 text-muted-foreground">
              {c}
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" className="mt-6" asChild>
          <Link href="/dashboard">
            <ArrowLeft /> Back to overview
          </Link>
        </Button>
      </div>
    </div>
  );
}
