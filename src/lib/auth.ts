import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { consume } from "@/server/rate-limit";

export const auth = betterAuth({
  appName: "Orbyte",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APPLICATION_URL],
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    // Email verification requires an email provider; tracked in the checklist.
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    // Cookie cache stays off so revoking a session takes effect immediately.
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: env.NODE_ENV !== "test" && env.AUTH_RATE_LIMIT === "on",
    // Shared across app instances via Redis (atomic check-and-increment).
    customStorage: { consume: (key, rule) => consume(`auth:${key}`, rule) },
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/change-password": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
    ipAddress: {
      ...(env.AUTH_IP_HEADERS ? { ipAddressHeaders: env.AUTH_IP_HEADERS.split(",").map((h) => h.trim()).filter(Boolean) } : {}),
      ...(env.TRUSTED_PROXIES ? { trustedProxies: env.TRUSTED_PROXIES.split(",").map((p) => p.trim()).filter(Boolean) } : {}),
    },
    database: { generateId: false }, // Prisma generates cuid ids
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await db.activityLog.create({
            data: { ownerId: user.id, action: "account.created", entityType: "user", entityId: user.id },
          });
        },
      },
    },
  },
  // Must be last: lets server actions set auth cookies.
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
