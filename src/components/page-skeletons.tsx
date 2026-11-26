import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading skeletons, shaped like the pages they stand in for. */
function Header() {
  return (
    <>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 mb-8 h-4 w-80 max-w-full" />
    </>
  );
}

export function ListSkeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Header />
      <div className="space-y-px overflow-hidden rounded-xl border border-border">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-none" />
        ))}
      </div>
    </div>
  );
}

export function CardGridSkeleton({ label, cards = 6 }: { label: string; cards?: number }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Header />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function DetailSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Skeleton className="mb-3 h-3 w-24" />
      <Header />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-[420px] rounded-xl" />
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    </div>
  );
}

export function FormSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="max-w-2xl space-y-4">
      <Header />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

export function StudioSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Workflow Studio" className="flex h-full flex-col">
      <Skeleton className="h-12 rounded-none" />
      <div className="flex min-h-0 flex-1">
        <Skeleton className="hidden w-60 rounded-none lg:block" />
        <div className="flex-1" />
        <Skeleton className="hidden w-80 rounded-none lg:block" />
      </div>
    </div>
  );
}
