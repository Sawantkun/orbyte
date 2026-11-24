import { ok, parseJson, withUser } from "@/server/api";
import { bulkAssetsSchema } from "@/lib/validation/assets";
import { bulkUpdate } from "@/server/assets/service";

/** Applies to the caller's own assets only; ids belonging to others are ignored. */
export const POST = withUser(async (req, { user }) => {
  const { ids, op } = await parseJson(req, bulkAssetsSchema);
  return ok(await bulkUpdate(user.id, ids, op));
});
