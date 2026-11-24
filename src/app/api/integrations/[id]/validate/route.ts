import { ok, withUser } from "@/server/api";
import { revalidateIntegration } from "@/server/integrations";

export const POST = withUser<RouteContext<"/api/integrations/[id]/validate">>(async (_req, { params, user }) => {
  const { id } = await params;
  return ok(await revalidateIntegration(user.id, id));
});
