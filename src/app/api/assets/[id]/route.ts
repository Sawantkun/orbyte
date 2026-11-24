import { ok, parseJson, withUser } from "@/server/api";
import { updateAssetSchema } from "@/lib/validation/assets";
import { deleteAssets, getAsset, relatedAssets, updateAsset } from "@/server/assets/service";
import { notFound } from "@/server/errors";

type Ctx = RouteContext<"/api/assets/[id]">;

export const GET = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  const asset = await getAsset(user.id, id);
  return ok({ ...asset, related: await relatedAssets(user.id, asset) });
});

export const PATCH = withUser<Ctx>(async (req, { params, user }) => {
  const { id } = await params;
  return ok(await updateAsset(user.id, id, await parseJson(req, updateAssetSchema)));
});

export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  if ((await deleteAssets(user.id, [id])) === 0) throw notFound("Asset");
  return new Response(null, { status: 204 });
});
