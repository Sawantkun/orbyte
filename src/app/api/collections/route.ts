import { z } from "zod";
import { ok, parseJson, parseQuery, withUser } from "@/server/api";
import { collectionSchema } from "@/lib/validation/assets";
import { createCollection, listCollections } from "@/server/collections";

export const GET = withUser(async (req, { user }) => {
  const { q } = parseQuery(req, z.object({ q: z.string().trim().max(120).optional() }));
  return ok(await listCollections(user.id, q));
});

export const POST = withUser(async (req, { user }) => ok(await createCollection(user.id, await parseJson(req, collectionSchema)), { status: 201 }));
