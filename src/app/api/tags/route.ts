import { ok, withUser } from "@/server/api";
import { listTags } from "@/server/assets/service";

export const GET = withUser(async (_req, { user }) => ok(await listTags(user.id)));
