"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isAPIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { changePasswordSchema, profileSchema } from "@/lib/validation/auth";
import { recordActivity } from "@/server/activity";
import { getSession, requireUser } from "@/server/session";
import { revokeUserSession } from "@/server/sessions";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await auth.api.updateUser({ headers: await headers(), body: { name: parsed.data.name } });
  } catch (err) {
    console.error("[settings] updateProfile failed", { userId: user.id, name: (err as Error)?.name });
    return { ok: false, error: "We couldn't save your profile. Please try again." };
  }
  await recordActivity({ ownerId: user.id, action: "profile.updated", entityType: "user", entityId: user.id });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changePassword(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: parsed.data.revokeOtherSessions,
      },
    });
  } catch (err) {
    if (isAPIError(err) && err.body?.code === "INVALID_PASSWORD") {
      return { ok: false, error: "Your current password is incorrect." };
    }
    console.error("[settings] changePassword failed", { userId: user.id, name: (err as Error)?.name });
    return { ok: false, error: "We couldn't change your password. Please try again." };
  }
  await recordActivity({ ownerId: user.id, action: "password.changed", entityType: "user", entityId: user.id });
  revalidatePath("/settings/security");
  return { ok: true };
}

/** Revoke one of the current user's other sessions, addressed by id (tokens never leave the server). */
export async function revokeSession(sessionId: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const current = await getSession();
  const result = await revokeUserSession(user.id, sessionId, current?.session.id);
  if (result.ok) revalidatePath("/settings/security");
  return result;
}
