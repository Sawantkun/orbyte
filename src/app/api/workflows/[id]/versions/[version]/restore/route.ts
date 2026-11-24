import { ok, parseWith, withUser } from "@/server/api";
import { versionParam } from "@/lib/validation/params";
import { restoreVersion } from "@/server/workflows";

export const POST = withUser<RouteContext<"/api/workflows/[id]/versions/[version]/restore">>(async (_req, { params, user }) => {
  const { id, version } = await params;
  return ok(await restoreVersion(user.id, id, parseWith(versionParam, version)));
});
