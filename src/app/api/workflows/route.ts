import { ok, parseJson, parseQuery, withUser } from "@/server/api";
import { createWorkflowSchema, listWorkflowsQuery } from "@/lib/validation/workflow";
import { createWorkflow, listWorkflows } from "@/server/workflows";

export const GET = withUser(async (req, { user }) => {
  const query = parseQuery(req, listWorkflowsQuery);
  const { items, nextCursor } = await listWorkflows(user.id, query);
  return ok(items, { meta: { nextCursor } });
});

export const POST = withUser(async (req, { user }) => {
  const input = await parseJson(req, createWorkflowSchema);
  return ok(await createWorkflow(user.id, input), { status: 201 });
});
