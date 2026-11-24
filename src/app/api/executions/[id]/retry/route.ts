import { ok, withUser } from "@/server/api";
import { retryExecution } from "@/server/executions";

export const POST = withUser<RouteContext<"/api/executions/[id]/retry">>(async (_req, { params, user }) => {
  const { id } = await params;
  return ok(await retryExecution(user.id, id), { status: 201 });
});
