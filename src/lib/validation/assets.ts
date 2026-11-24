import { z } from "zod";

export const ASSET_KINDS = ["IMAGE", "VIDEO", "AUDIO", "PDF", "DOCUMENT", "TEXT", "JSON", "CODE", "OTHER"] as const;
const id = z.string().min(1).max(40);
const dateParam = z.iso.date().transform((d) => new Date(`${d}T00:00:00Z`));

export const listAssetsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  kinds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(ASSET_KINDS)).max(9).optional()),
  collectionId: id.optional(),
  tag: z.string().trim().max(40).optional(),
  favorite: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  workflowId: id.optional(),
  source: z.enum(["UPLOAD", "WORKFLOW"]).optional(),
  from: dateParam.optional(),
  to: dateParam.transform((d) => new Date(d.getTime() + 86_400_000 - 1)).optional(),
  sort: z.enum(["newest", "oldest", "name", "size"]).default("newest"),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const tags = z.array(z.string().max(60)).max(20);

export const updateAssetSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    tags: tags.optional(),
    collectionId: id.nullable().optional(),
    isFavorite: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const bulkAssetsSchema = z.object({
  ids: z.array(id).min(1).max(100),
  op: z.discriminatedUnion("action", [
    z.object({ action: z.literal("delete") }),
    z.object({ action: z.literal("favorite"), value: z.boolean() }),
    z.object({ action: z.literal("move"), collectionId: id.nullable() }),
    z.object({ action: z.literal("addTags"), tags: tags.min(1) }),
    z.object({ action: z.literal("removeTags"), tags: tags.min(1) }),
  ]),
});

export const collectionSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).optional(),
});

export const updateCollectionSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    coverAssetId: id.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
