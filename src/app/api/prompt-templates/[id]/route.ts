import { ok, parseJson, withUser } from "@/server/api";
import { updatePromptTemplateSchema } from "@/lib/validation/workflow";
import { deletePromptTemplate, updatePromptTemplate } from "@/server/prompt-templates";

type Ctx = RouteContext<"/api/prompt-templates/[id]">;

export const PATCH = withUser<Ctx>(async (req, { params, user }) => {
  const { id } = await params;
  return ok(await updatePromptTemplate(user.id, id, await parseJson(req, updatePromptTemplateSchema)));
});

export const DELETE = withUser<Ctx>(async (_req, { params, user }) => {
  const { id } = await params;
  await deletePromptTemplate(user.id, id);
  return new Response(null, { status: 204 });
});
