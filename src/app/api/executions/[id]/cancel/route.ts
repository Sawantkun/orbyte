import { ok, withUser } from "@/server/api";
import { cancelExecution } from "@/server/executions";

export const POST = withUser<RouteContext<"/api/executions/[id]/cancel">>(async (_req, { params, user }) => {
  const { id } = await params;
  return ok(await cancelExecution(user.id, id));
});
