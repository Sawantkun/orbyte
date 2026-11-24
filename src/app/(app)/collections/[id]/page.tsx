import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AssetLibrary } from "@/components/assets/asset-library";
import { CollectionHeader } from "@/components/assets/collection-header";
import { ACCEPT_ATTRIBUTE } from "@/server/assets/files";
import { getCollection, listCollections } from "@/server/collections";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Collection" };

export default async function CollectionPage({ params }: PageProps<"/collections/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const collection = await getCollection(user.id, id).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const collections = await listCollections(user.id);
  return (
    <>
      <CollectionHeader key={collection.id} collection={collection} />
      <AssetLibrary collections={collections} fixedCollectionId={collection.id} accept={ACCEPT_ATTRIBUTE} />
    </>
  );
}
