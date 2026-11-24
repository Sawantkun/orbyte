import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading executions">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 mb-8 h-4 w-72" />
      <Skeleton className="mb-4 h-7 w-96" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
