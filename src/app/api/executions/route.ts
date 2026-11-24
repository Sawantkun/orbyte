import { ok, parseQuery, withUser } from "@/server/api";
import { listExecutionsQuery } from "@/lib/validation/workflow";
import { listExecutions } from "@/server/executions";

export const GET = withUser(async (req, { user }) => {
  const { items, nextCursor } = await listExecutions(user.id, parseQuery(req, listExecutionsQuery));
  return ok(items, { meta: { nextCursor } });
});
