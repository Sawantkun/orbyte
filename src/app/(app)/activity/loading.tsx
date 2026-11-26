import { ListSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  return <ListSkeleton label="Loading activity" rows={10} />;
}
