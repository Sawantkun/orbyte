import { ok, parseJson, withUser } from "@/server/api";
import { updateWorkflowSchema } from "@/lib/validation/workflow";
import { deleteWorkflow, getWorkflow, updateWorkflow } from "@/server/workflows";

type Ctx = RouteContext<"/api/workflows/[id]">;

export const GET = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  return ok(await getWorkflow(user.id, id));
});

export const PATCH = withUser<Ctx>(async (req, { params, user }) => {
  const { id } = await params;
  const input = await parseJson(req, updateWorkflowSchema);
  return ok(await updateWorkflow(user.id, id, input));
});

export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  await deleteWorkflow(user.id, id);
  return new Response(null, { status: 204 });
});
