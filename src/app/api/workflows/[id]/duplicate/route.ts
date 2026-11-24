import { ok, withUser } from "@/server/api";
import { duplicateWorkflow } from "@/server/workflows";

export const POST = withUser<RouteContext<"/api/workflows/[id]/duplicate">>(async (_req, { params, user }) => {
  const { id } = await params;
  return ok(await duplicateWorkflow(user.id, id), { status: 201 });
});
