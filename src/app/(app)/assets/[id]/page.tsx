import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AssetDetailView } from "@/components/assets/asset-detail";
import { getAsset, relatedAssets } from "@/server/assets/service";
import { listCollections } from "@/server/collections";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Asset" };

export default async function AssetPage({ params }: PageProps<"/assets/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getAsset(user.id, id).catch((e: unknown) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const [related, collections] = await Promise.all([relatedAssets(user.id, asset), listCollections(user.id)]);
  return <AssetDetailView key={asset.id} initial={asset} related={related} collections={collections} />;
}
