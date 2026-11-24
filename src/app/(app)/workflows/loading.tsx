import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading workflows">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 mb-8 h-4 w-72" />
      <Skeleton className="mb-4 h-8 w-80" />
      <div className="space-y-px overflow-hidden rounded-xl border border-border">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-none" />
        ))}
      </div>
    </div>
  );
}
