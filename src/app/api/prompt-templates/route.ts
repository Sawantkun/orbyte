import { z } from "zod";
import { ok, parseJson, parseQuery, withUser } from "@/server/api";
import { promptTemplateSchema } from "@/lib/validation/workflow";
import { createPromptTemplate, listPromptTemplates } from "@/server/prompt-templates";

export const GET = withUser(async (req, { user }) => {
  const { q } = parseQuery(req, z.object({ q: z.string().trim().max(120).optional() }));
  return ok(await listPromptTemplates(user.id, q));
});

export const POST = withUser(async (req, { user }) => {
  const input = await parseJson(req, promptTemplateSchema);
  return ok(await createPromptTemplate(user.id, input), { status: 201 });
});
