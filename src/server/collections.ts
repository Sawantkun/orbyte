import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { recordActivity } from "./activity";
import { conflict, notFound } from "./errors";

export type CollectionSummary = {
  id: string;
  name: string;
  description: string | null;
  assetCount: number;
  /** Asset id whose thumbnail represents the collection (explicit cover, else newest image). */
  coverAssetId: string | null;
  updatedAt: string;
};

function rethrowUnique(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("You already have a collection with this name.");
  throw e;
}

async function withCovers(rows: { id: string; name: string; description: string | null; coverAssetId: string | null; updatedAt: Date; _count: { assets: number } }[]): Promise<CollectionSummary[]> {
  const needFallback = rows.filter((r) => !r.coverAssetId).map((r) => r.id);
  const fallbacks = needFallback.length
    ? await db.asset.findMany({
        where: { collectionId: { in: needFallback }, thumbnailKey: { not: null } },
        orderBy: { createdAt: "desc" },
        distinct: ["collectionId"],
        select: { id: true, collectionId: true },
      })
    : [];
  const byCollection = new Map(fallbacks.map((f) => [f.collectionId, f.id]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    assetCount: r._count.assets,
    coverAssetId: r.coverAssetId ?? byCollection.get(r.id) ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

const select = { id: true, name: true, description: true, coverAssetId: true, updatedAt: true, _count: { select: { assets: true } } } as const;

export async function listCollections(ownerId: string, q?: string): Promise<CollectionSummary[]> {
  const rows = await db.assetCollection.findMany({
    where: { ownerId, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select,
  });
  return withCovers(rows);
}

export async function getCollection(ownerId: string, id: string): Promise<CollectionSummary> {
  const row = await db.assetCollection.findFirst({ where: { id, ownerId }, select });
  if (!row) throw notFound("Collection");
  return (await withCovers([row]))[0];
}

export async function createCollection(ownerId: string, input: { name: string; description?: string }): Promise<CollectionSummary> {
  try {
    const c = await db.assetCollection.create({ data: { ownerId, name: input.name, description: input.description || null }, select });
    await recordActivity({ ownerId, action: "collection.created", entityType: "collection", entityId: c.id, metadata: { name: c.name } });
    return (await withCovers([c]))[0];
  } catch (e) {
    rethrowUnique(e);
  }
}

export async function updateCollection(ownerId: string, id: string, input: { name?: string; description?: string | null; coverAssetId?: string | null }) {
  const c = await db.assetCollection.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!c) throw notFound("Collection");
  if (input.coverAssetId) {
    const asset = await db.asset.findFirst({ where: { id: input.coverAssetId, ownerId }, select: { id: true } });
    if (!asset) throw notFound("Asset");
  }
  try {
    await db.assetCollection.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.coverAssetId !== undefined ? { coverAssetId: input.coverAssetId } : {}),
      },
    });
  } catch (e) {
    rethrowUnique(e);
  }
  return getCollection(ownerId, id);
}

/** Deletes the collection only. Its assets stay in the library (collectionId → NULL via FK). */
export async function deleteCollection(ownerId: string, id: string): Promise<{ releasedAssets: number }> {
  const c = await db.assetCollection.findFirst({ where: { id, ownerId }, select: { name: true, _count: { select: { assets: true } } } });
  if (!c) throw notFound("Collection");
  await db.assetCollection.deleteMany({ where: { id, ownerId } });
  await recordActivity({ ownerId, action: "collection.deleted", entityType: "collection", entityId: id, metadata: { name: c.name } });
  return { releasedAssets: c._count.assets };
}
