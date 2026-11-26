"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";

const noopSubscribe = () => () => {};

/** False during SSR and hydration, true afterwards — without a setState-in-effect. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Deterministic text for SSR/hydration (UTC, from the ISO string itself). */
const stableText = (iso: string) => iso.slice(0, 10);

/**
 * Renders a time without hydration mismatches. Server and first client render
 * show the UTC date; after hydration it switches to local relative ("3 min ago")
 * or a local pattern, and relative times refresh every 30 s.
 */
export function Time({ iso, pattern, className }: { iso: string; pattern?: string; className?: string }) {
  const hydrated = useHydrated();
  const [, tick] = useState(0);
  useEffect(() => {
    if (pattern) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [pattern]);

  const d = new Date(iso);
  const text = !hydrated ? stableText(iso) : pattern ? format(d, pattern) : formatDistanceToNowStrict(d, { addSuffix: true });
  return (
    <time dateTime={iso} title={hydrated ? format(d, "PPpp") : undefined} className={className}>
      {text}
    </time>
  );
}
