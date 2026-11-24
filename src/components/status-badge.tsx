import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/format";

const TONES: Record<string, string> = {
  COMPLETED: "bg-success/10 text-success border-success/20",
  ACTIVE: "bg-success/10 text-success border-success/20",
  FAILED: "bg-destructive/10 text-destructive border-destructive/20",
  RUNNING: "bg-primary/10 text-[var(--ob-accent-2)] border-primary/20",
  PENDING: "bg-warning/10 text-warning border-warning/20",
  CANCELLED: "bg-muted text-muted-foreground border-border",
  SKIPPED: "bg-muted text-muted-foreground border-border",
  DRAFT: "bg-muted text-muted-foreground border-border",
  ARCHIVED: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-[11px] font-medium",
        TONES[status] ?? TONES.DRAFT,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {titleCase(status)}
    </span>
  );
}
