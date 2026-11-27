import { z } from "zod";
import { ok, parseJson, withUser } from "@/server/api";
import { deleteIntegration, renameIntegration, replaceIntegrationSecret, setDefaultIntegration } from "@/server/integrations";

type Ctx = RouteContext<"/api/integrations/[id]">;

const patchSchema = z.union([
  z.object({ secret: z.string().trim().min(1).max(500) }).strict(),
  z.object({ isDefault: z.literal(true) }).strict(),
  z.object({ label: z.string().trim().min(1, "Enter a name").max(60) }).strict(),
]);

/** Replace the stored secret, make this the default credential, or rename it. */
export const PATCH = withUser<Ctx>(
  async (req, { params, user }) => {
    const { id } = await params;
    const body = await parseJson(req, patchSchema);
    if ("secret" in body) return ok(await replaceIntegrationSecret(user.id, id, body.secret));
    if ("isDefault" in body) return ok(await setDefaultIntegration(user.id, id));
    return ok(await renameIntegration(user.id, id, body.label));
  },
  { limit: "credentials" },
);

export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  await deleteIntegration(user.id, id);
  return new Response(null, { status: 204 });
});
