import type { Metadata } from "next";
import { CollectionsGrid } from "@/components/assets/collections-grid";
import { PageHeader } from "@/components/layout/page-header";
import { listCollections } from "@/server/collections";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const user = await requireUser();
  const collections = await listCollections(user.id);
  return (
    <>
      <PageHeader title="Collections" description="Organise assets into campaigns, clients, projects or anything else." />
      <CollectionsGrid initial={collections} />
    </>
  );
}
