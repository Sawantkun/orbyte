import { z } from "zod";
import { ok, parseQuery, withUser } from "@/server/api";
import { getUsageSummary } from "@/server/usage";

const query = z.object({ days: z.enum(["7", "30", "90"]).default("30").transform(Number) });

export const GET = withUser(async (req, { user }) => {
  const { days } = parseQuery(req, query);
  return ok(await getUsageSummary(user.id, days as 7 | 30 | 90));
});
