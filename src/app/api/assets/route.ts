import { ok, parseQuery, withUser } from "@/server/api";
import { listAssetsQuery } from "@/lib/validation/assets";
import { listAssets } from "@/server/assets/service";

export const GET = withUser(async (req, { user }) => {
  const { items, nextCursor } = await listAssets(user.id, parseQuery(req, listAssetsQuery));
  return ok(items, { meta: { nextCursor } });
});
