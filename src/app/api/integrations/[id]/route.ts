import { z } from "zod";
import { ok, parseJson, withUser } from "@/server/api";
import { deleteIntegration, replaceIntegrationSecret } from "@/server/integrations";

type Ctx = RouteContext<"/api/integrations/[id]">;

/** Replace the stored key. */
export const PATCH = withUser<Ctx>(async (req, { params, user }) => {
  const { id } = await params;
  const { secret } = await parseJson(req, z.object({ secret: z.string().trim().min(1).max(500) }));
  return ok(await replaceIntegrationSecret(user.id, id, secret));
}, { limit: "credentials" });

export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  await deleteIntegration(user.id, id);
  return new Response(null, { status: 204 });
});
