import type { Metadata } from "next";
import { AssetLibrary } from "@/components/assets/asset-library";
import { PageHeader } from "@/components/layout/page-header";
import { ACCEPT_ATTRIBUTE } from "@/server/assets/files";
import { listCollections } from "@/server/collections";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Assets" };

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const user = await requireUser();
  const [collections, sp] = await Promise.all([listCollections(user.id), searchParams]);
  return (
    <>
      <PageHeader title="Assets" description="Everything you upload and everything your workflows create, in one searchable library." />
      <AssetLibrary collections={collections} accept={ACCEPT_ATTRIBUTE} autoOpenUpload={sp.upload === "1"} />
    </>
  );
}
