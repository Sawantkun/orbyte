import { ok, parseWith, withUser } from "@/server/api";
import { versionParam } from "@/lib/validation/params";
import { getVersion } from "@/server/workflows";

export const GET = withUser<RouteContext<"/api/workflows/[id]/versions/[version]">>(async (_req, { params, user }) => {
  const { id, version } = await params;
  return ok(await getVersion(user.id, id, parseWith(versionParam, version)));
});
