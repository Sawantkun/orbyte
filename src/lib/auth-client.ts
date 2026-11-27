"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// Same-origin: the auth API is served by this Next.js app at /api/auth.
// Two-factor accounts: sign-in returns { twoFactorRedirect: true } and LoginForm routes to /two-factor.
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });

export const { signIn, signUp, signOut, useSession } = authClient;
