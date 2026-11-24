import { ok, withUser } from "@/server/api";
import { getWorkflow, listVersions } from "@/server/workflows";

export const GET = withUser<RouteContext<"/api/workflows/[id]/versions">>(async (_req, { params, user }) => {
  const { id } = await params;
  await getWorkflow(user.id, id); // 404 for workflows the caller doesn't own
  return ok(await listVersions(user.id, id));
});
