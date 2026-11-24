import { cn } from "@/lib/utils";

/**
 * The Orbyte mark: an "O" drawn as an orbit, broken where a satellite node
 * sits on it, with a core node at the centre — workflows connecting into a
 * single organised workspace.
 */
export function OrbyteMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn("size-6", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path
        d="M25.56 13.08A10 10 0 1 1 18.92 6.44"
        stroke="var(--ob-accent, #8B5CF6)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="23.07" cy="8.93" r="3" fill="var(--ob-accent-2, #A78BFA)" />
      <circle cx="16" cy="16" r="2.75" fill="var(--ob-text, #F5F5F7)" />
    </svg>
  );
}

export function OrbyteLogo({ className, collapsed = false }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <OrbyteMark title="Orbyte" />
      {!collapsed && <span className="text-[15px] font-semibold tracking-tight text-foreground">Orbyte</span>}
    </span>
  );
}
