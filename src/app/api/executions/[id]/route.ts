import { ok, withUser } from "@/server/api";
import { getExecution } from "@/server/executions";

export const GET = withUser<RouteContext<"/api/executions/[id]">>(async (_req, { params, user }) => {
  const { id } = await params;
  return ok(await getExecution(user.id, id));
});
