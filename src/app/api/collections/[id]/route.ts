import { ok, parseJson, withUser } from "@/server/api";
import { updateCollectionSchema } from "@/lib/validation/assets";
import { deleteCollection, getCollection, updateCollection } from "@/server/collections";

type Ctx = RouteContext<"/api/collections/[id]">;

export const GET = withUser<Ctx>(async (_req, { params, user }) => ok(await getCollection(user.id, (await params).id)));

export const PATCH = withUser<Ctx>(async (req, { params, user }) => {
  const { id } = await params;
  return ok(await updateCollection(user.id, id, await parseJson(req, updateCollectionSchema)));
});

/** Assets in the collection are kept. */
export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  return ok(await deleteCollection(user.id, id));
});
