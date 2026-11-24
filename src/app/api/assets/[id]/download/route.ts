import { withUser } from "@/server/api";
import { contentResponse } from "@/server/assets/http";
import { openAssetContent } from "@/server/assets/service";

export const GET = withUser<RouteContext<"/api/assets/[id]/download">>(async (_req, { params, user }) => {
  const { id } = await params;
  return contentResponse(await openAssetContent(user.id, id, "original"), "attachment", 0);
});
