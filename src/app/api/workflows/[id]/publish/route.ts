import { ok, parseJson, withUser } from "@/server/api";
import { publishWorkflowSchema } from "@/lib/validation/workflow";
import { publishWorkflow } from "@/server/workflows";

export const POST = withUser<RouteContext<"/api/workflows/[id]/publish">>(async (req, { params, user }) => {
  const { id } = await params;
  const { expectedUpdatedAt } = await parseJson(req, publishWorkflowSchema);
  return ok(await publishWorkflow(user.id, id, expectedUpdatedAt), { status: 201 });
});
