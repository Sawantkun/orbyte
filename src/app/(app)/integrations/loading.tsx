import { CardGridSkeleton } from "@/components/page-skeletons";

export default function Loading() {
  return <CardGridSkeleton label="Loading integrations" cards={3} />;
}
