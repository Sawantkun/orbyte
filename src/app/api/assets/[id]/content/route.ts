import { withUser } from "@/server/api";
import { contentResponse } from "@/server/assets/http";
import { openAssetContent } from "@/server/assets/service";

/** Inline preview: ?variant=thumbnail|original. Storage keys never change, so thumbnails cache well. */
export const GET = withUser<RouteContext<"/api/assets/[id]/content">>(async (req, { params, user }) => {
  const { id } = await params;
  const variant = new URL(req.url).searchParams.get("variant") === "thumbnail" ? "thumbnail" : "original";
  // Range support lets browsers seek within video and audio.
  return contentResponse(await openAssetContent(user.id, id, variant, req.headers.get("range")), "inline", variant === "thumbnail" ? 86_400 : 300);
});
