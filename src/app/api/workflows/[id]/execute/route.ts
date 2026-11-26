import { ok, parseJson, withUser } from "@/server/api";
import { executeWorkflowSchema } from "@/lib/validation/workflow";
import { startExecution } from "@/server/executions";

/** Runs the latest published version. 201 when created, 200 when an idempotency key matched an existing run. */
export const POST = withUser<RouteContext<"/api/workflows/[id]/execute">>(async (req, { params, user }) => {
  const { id } = await params;
  const body = await parseJson(req, executeWorkflowSchema);
  const { execution, created } = await startExecution(user.id, id, body);
  return ok(execution, { status: created ? 201 : 200 });
}, { limit: "execute" });
