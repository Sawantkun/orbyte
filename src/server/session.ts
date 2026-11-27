import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Data Access Layer for the current user. Every authenticated page, server
 * action and route handler goes through here; the proxy's cookie check is
 * only an optimistic redirect, not authorization.
 */
export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
};

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session) return null;
  const { id, name, email, image, emailVerified } = session.user;
  return { id, name, email, image: image ?? null, emailVerified };
}

/** For pages and server actions: redirects to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
