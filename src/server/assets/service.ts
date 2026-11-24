import "server-only";
import sharp from "sharp";
import { Prisma, type AssetKind, type AssetSource } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { recordActivity } from "../activity";
import { AppError, notFound } from "../errors";
import { getStorage, newStorageKey, thumbnailKeyFor } from "../storage";
import { StorageError } from "../storage/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AssetSummary = {
  id: string;
  name: string;
  kind: AssetKind;
  source: AssetSource;
  mimeType: string;
  extension: string | null;
  sizeBytes: number;
  hasThumbnail: boolean;
  isFavorite: boolean;
  collectionId: string | null;
  tags: string[];
  workflowName: string | null;
  createdAt: string;
};

export type AssetDetail = AssetSummary & {
  description: string | null;
  originalPrompt: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  workflowId: string | null;
  executionId: string | null;
  nodeId: string | null;
  metadata: Record<string, unknown> | null;
  collection: { id: string; name: string } | null;
  updatedAt: string;
};

export type ListAssetsQuery = {
  q?: string;
  kinds?: AssetKind[];
  collectionId?: string;
  tag?: string;
  favorite?: boolean;
  workflowId?: string;
  source?: AssetSource;
  from?: Date;
  to?: Date;
  sort: "newest" | "oldest" | "name" | "size";
  cursor?: string;
  limit: number;
};

export type NewAsset = {
  name: string;
  buffer: Buffer;
  mimeType: string;
  extension: string | null;
  kind: AssetKind;
  source: AssetSource;
  description?: string | null;
  tags?: string[];
  collectionId?: string | null;
  originalPrompt?: string | null;
  aiProvider?: string | null;
  aiModel?: string | null;
  workflowId?: string | null;
  executionId?: string | null;
  nodeId?: string | null;
  metadata?: Record<string, unknown>;
};

const summaryInclude = {
  tags: { include: { tag: { select: { name: true } } } },
  workflow: { select: { name: true } },
} as const;
type SummaryRow = Prisma.AssetGetPayload<{ include: typeof summaryInclude }>;

function toSummary(a: SummaryRow): AssetSummary {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    source: a.source,
    mimeType: a.mimeType,
    extension: a.extension,
    sizeBytes: a.sizeBytes,
    hasThumbnail: a.thumbnailKey !== null,
    isFavorite: a.isFavorite,
    collectionId: a.collectionId,
    tags: a.tags.map((t) => t.tag.name).sort(),
    workflowName: a.workflow?.name ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

// ─── Tags ────────────────────────────────────────────────────────────────────

export const MAX_TAGS = 20;

export function normalizeTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const raw of tags) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    if (t) out.add(t);
  }
  if (out.size > MAX_TAGS) throw new AppError(400, "TOO_MANY_TAGS", `Use at most ${MAX_TAGS} tags.`);
  return [...out];
}

async function tagIds(tx: Prisma.TransactionClient, ownerId: string, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  await tx.assetTag.createMany({ data: names.map((name) => ({ ownerId, name })), skipDuplicates: true });
  const rows = await tx.assetTag.findMany({ where: { ownerId, name: { in: names } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function assertCollection(tx: Prisma.TransactionClient | typeof db, ownerId: string, collectionId: string | null | undefined) {
  if (!collectionId) return;
  const c = await tx.assetCollection.findFirst({ where: { id: collectionId, ownerId }, select: { id: true } });
  if (!c) throw notFound("Collection");
}

// ─── Thumbnails ──────────────────────────────────────────────────────────────

const THUMBNAIL_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/** 480px WebP thumbnail + dimensions. Never throws: a bad image just gets no thumbnail. */
export async function makeThumbnail(buffer: Buffer, mimeType: string): Promise<{ thumb: Buffer; width: number; height: number } | null> {
  if (!THUMBNAIL_TYPES.has(mimeType)) return null;
  try {
    const img = sharp(buffer, { limitInputPixels: 64_000_000, animated: false }).timeout({ seconds: 10 });
    const meta = await img.metadata();
    const thumb = await img.rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return { thumb, width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    return null;
  }
}

// ─── Create ──────────────────────────────────────────────────────────────────

/** Store the binary (and thumbnail), then create the row. Storage is cleaned up if the DB write fails. */
export async function createAsset(ownerId: string, input: NewAsset): Promise<AssetSummary> {
  await assertCollection(db, ownerId, input.collectionId);
  const tags = normalizeTags(input.tags ?? []);
  const storage = getStorage();
  const storageKey = newStorageKey(ownerId, input.extension);
  const thumbnail = await makeThumbnail(input.buffer, input.mimeType);
  const thumbnailKey = thumbnail ? thumbnailKeyFor(storageKey) : null;

  await storage.put(storageKey, input.buffer, input.mimeType);
  if (thumbnail && thumbnailKey) await storage.put(thumbnailKey, thumbnail.thumb, "image/webp");

  try {
    const asset = await db.$transaction(async (tx) => {
      const ids = await tagIds(tx, ownerId, tags);
      return tx.asset.create({
        data: {
          ownerId,
          name: input.name.slice(0, 200),
          description: input.description ?? null,
          kind: input.kind,
          source: input.source,
          mimeType: input.mimeType,
          extension: input.extension,
          sizeBytes: input.buffer.length,
          storageKey,
          thumbnailKey,
          collectionId: input.collectionId ?? null,
          originalPrompt: input.originalPrompt ?? null,
          aiProvider: input.aiProvider ?? null,
          aiModel: input.aiModel ?? null,
          workflowId: input.workflowId ?? null,
          executionId: input.executionId ?? null,
          nodeId: input.nodeId ?? null,
          metadata: { ...(input.metadata ?? {}), ...(thumbnail ? { width: thumbnail.width, height: thumbnail.height } : {}) } as Prisma.InputJsonValue,
          tags: { create: ids.map((tagId) => ({ tagId })) },
        },
        include: summaryInclude,
      });
    });
    await recordActivity({
      ownerId,
      action: input.source === "WORKFLOW" ? "asset.generated" : "asset.uploaded",
      entityType: "asset",
      entityId: asset.id,
      metadata: { name: asset.name },
    });
    return toSummary(asset);
  } catch (e) {
    await Promise.allSettled([storage.delete(storageKey), thumbnailKey ? storage.delete(thumbnailKey) : Promise.resolve()]);
    throw e;
  }
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function listAssets(ownerId: string, q: ListAssetsQuery): Promise<{ items: AssetSummary[]; nextCursor: string | null }> {
  const and: Prisma.AssetWhereInput[] = [{ ownerId }];
  if (q.kinds?.length) and.push({ kind: { in: q.kinds } });
  if (q.collectionId) and.push({ collectionId: q.collectionId });
  if (q.workflowId) and.push({ workflowId: q.workflowId });
  if (q.source) and.push({ source: q.source });
  if (q.favorite) and.push({ isFavorite: true });
  if (q.tag) and.push({ tags: { some: { tag: { name: q.tag.toLowerCase() } } } });
  if (q.from) and.push({ createdAt: { gte: q.from } });
  if (q.to) and.push({ createdAt: { lte: q.to } });
  if (q.q) {
    const contains = { contains: q.q, mode: "insensitive" as const };
    and.push({
      OR: [
        { name: contains },
        { description: contains },
        { originalPrompt: contains },
        { tags: { some: { tag: { name: contains } } } },
        { workflow: { name: contains } },
      ],
    });
  }
  const orderBy: Prisma.AssetOrderByWithRelationInput[] =
    q.sort === "oldest"
      ? [{ createdAt: "asc" }, { id: "asc" }]
      : q.sort === "name"
        ? [{ name: "asc" }, { id: "asc" }]
        : q.sort === "size"
          ? [{ sizeBytes: "desc" }, { id: "desc" }]
          : [{ createdAt: "desc" }, { id: "desc" }];

  const rows = await db.asset.findMany({
    where: { AND: and },
    include: summaryInclude,
    orderBy,
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, q.limit).map(toSummary);
  return { items, nextCursor: rows.length > q.limit ? items[items.length - 1].id : null };
}

export async function getAsset(ownerId: string, id: string): Promise<AssetDetail> {
  const a = await db.asset.findFirst({
    where: { id, ownerId },
    include: { ...summaryInclude, collection: { select: { id: true, name: true } } },
  });
  if (!a) throw notFound("Asset");
  return {
    ...toSummary(a),
    description: a.description,
    originalPrompt: a.originalPrompt,
    aiProvider: a.aiProvider,
    aiModel: a.aiModel,
    workflowId: a.workflowId,
    executionId: a.executionId,
    nodeId: a.nodeId,
    metadata: (a.metadata as Record<string, unknown> | null) ?? null,
    collection: a.collection,
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** Same execution, then same workflow, then same collection. */
export async function relatedAssets(ownerId: string, asset: AssetDetail, take = 8): Promise<AssetSummary[]> {
  const or: Prisma.AssetWhereInput[] = [];
  if (asset.executionId) or.push({ executionId: asset.executionId });
  if (asset.workflowId) or.push({ workflowId: asset.workflowId });
  if (asset.collectionId) or.push({ collectionId: asset.collectionId });
  if (or.length === 0) return [];
  const rows = await db.asset.findMany({
    where: { ownerId, id: { not: asset.id }, OR: or },
    include: summaryInclude,
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map(toSummary);
}

export async function openAssetContent(ownerId: string, id: string, variant: "original" | "thumbnail") {
  const a = await db.asset.findFirst({ where: { id, ownerId }, select: { name: true, mimeType: true, extension: true, storageKey: true, thumbnailKey: true } });
  if (!a) throw notFound("Asset");
  const key = variant === "thumbnail" ? a.thumbnailKey : a.storageKey;
  if (!key) throw notFound("Thumbnail");
  let obj;
  try {
    obj = await getStorage().get(key);
  } catch (e) {
    if (e instanceof StorageError) obj = null;
    else throw e;
  }
  if (!obj) throw new AppError(410, "CONTENT_MISSING", "This file is no longer available in storage.");
  return { ...obj, name: a.name, extension: a.extension, mimeType: variant === "thumbnail" ? "image/webp" : a.mimeType };
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateAsset(
  ownerId: string,
  id: string,
  input: { name?: string; description?: string | null; tags?: string[]; collectionId?: string | null; isFavorite?: boolean },
): Promise<AssetDetail> {
  const exists = await db.asset.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!exists) throw notFound("Asset");
  await assertCollection(db, ownerId, input.collectionId);
  const tags = input.tags === undefined ? undefined : normalizeTags(input.tags);
  await db.$transaction(async (tx) => {
    await tx.asset.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.collectionId !== undefined ? { collectionId: input.collectionId } : {}),
        ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
      },
    });
    if (tags) {
      const ids = await tagIds(tx, ownerId, tags);
      await tx.assetTagRelation.deleteMany({ where: { assetId: id, tagId: { notIn: ids } } });
      await tx.assetTagRelation.createMany({ data: ids.map((tagId) => ({ assetId: id, tagId })), skipDuplicates: true });
    }
  });
  return getAsset(ownerId, id);
}

// ─── Delete & bulk ───────────────────────────────────────────────────────────

/** Delete owned assets (others are ignored) and their stored objects. Returns the number deleted. */
export async function deleteAssets(ownerId: string, ids: string[]): Promise<number> {
  const rows = await db.asset.findMany({ where: { ownerId, id: { in: ids } }, select: { id: true, storageKey: true, thumbnailKey: true } });
  if (rows.length === 0) return 0;
  await db.asset.deleteMany({ where: { ownerId, id: { in: rows.map((r) => r.id) } } });
  const storage = getStorage();
  const results = await Promise.allSettled(rows.flatMap((r) => [storage.delete(r.storageKey), ...(r.thumbnailKey ? [storage.delete(r.thumbnailKey)] : [])]));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) console.error(`[assets] ${failed} storage object(s) could not be deleted`, { ownerId });
  return rows.length;
}

export type BulkAction =
  | { action: "delete" }
  | { action: "favorite"; value: boolean }
  | { action: "move"; collectionId: string | null }
  | { action: "addTags"; tags: string[] }
  | { action: "removeTags"; tags: string[] };

export async function bulkUpdate(ownerId: string, ids: string[], op: BulkAction): Promise<{ affected: number }> {
  if (op.action === "delete") return { affected: await deleteAssets(ownerId, ids) };
  const owned = (await db.asset.findMany({ where: { ownerId, id: { in: ids } }, select: { id: true } })).map((a) => a.id);
  if (owned.length === 0) return { affected: 0 };
  switch (op.action) {
    case "favorite":
      await db.asset.updateMany({ where: { ownerId, id: { in: owned } }, data: { isFavorite: op.value } });
      break;
    case "move":
      await assertCollection(db, ownerId, op.collectionId);
      await db.asset.updateMany({ where: { ownerId, id: { in: owned } }, data: { collectionId: op.collectionId } });
      break;
    case "addTags": {
      const names = normalizeTags(op.tags);
      await db.$transaction(async (tx) => {
        const tagIdsList = await tagIds(tx, ownerId, names);
        await tx.assetTagRelation.createMany({ data: owned.flatMap((assetId) => tagIdsList.map((tagId) => ({ assetId, tagId }))), skipDuplicates: true });
      });
      break;
    }
    case "removeTags": {
      const names = normalizeTags(op.tags);
      await db.assetTagRelation.deleteMany({ where: { assetId: { in: owned }, tag: { ownerId, name: { in: names } } } });
      break;
    }
  }
  return { affected: owned.length };
}

export async function listTags(ownerId: string): Promise<{ name: string; count: number }[]> {
  const rows = await db.assetTag.findMany({
    where: { ownerId, assets: { some: {} } },
    select: { name: true, _count: { select: { assets: true } } },
    orderBy: { name: "asc" },
    take: 500,
  });
  return rows.map((r) => ({ name: r.name, count: r._count.assets }));
}
