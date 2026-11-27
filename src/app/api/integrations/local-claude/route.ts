import { z } from "zod";
import { ok, parseJson, withUser } from "@/server/api";
import { setLocalClaude } from "@/server/local-claude";

/** Switch the personal-use local Claude CLI provider on/off for the caller (owner-only). */
export const POST = withUser(
  async (req, { user }) => {
    const { enabled } = await parseJson(req, z.object({ enabled: z.boolean() }));
    return ok(await setLocalClaude(user.id, enabled));
  },
  { limit: "credentials" },
);
