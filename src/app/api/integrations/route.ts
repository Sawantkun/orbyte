import { z } from "zod";
import { ok, parseJson, withUser } from "@/server/api";
import { createIntegration, listIntegrations } from "@/server/integrations";

const createSchema = z.object({
  provider: z.string().min(1).max(40),
  secret: z.string().trim().min(1, "Enter an API key").max(500),
  label: z.string().trim().max(60).optional(),
});

export const GET = withUser(async (_req, { user }) => ok(await listIntegrations(user.id)));

export const POST = withUser(async (req, { user }) => ok(await createIntegration(user.id, await parseJson(req, createSchema)), { status: 201 }), { limit: "credentials" });
