import { z } from "zod";
import { ok, parseQuery, withUser } from "@/server/api";
import { listActivity } from "@/server/activity";

const query = z.object({ cursor: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export const GET = withUser(async (req, { user }) => {
  const { items, nextCursor } = await listActivity(user.id, parseQuery(req, query));
  return ok(items, { meta: { nextCursor } });
});
