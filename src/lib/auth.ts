import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { consume } from "@/server/rate-limit";
import { accountEmail, sendSystemEmail } from "@/server/system-mail";

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
    requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION === "on",
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
    // A reset signs out every other device.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Not awaited: response time mustn't reveal whether the account exists.
      void sendSystemEmail(
        accountEmail({
          to: user.email,
          name: user.name,
          subject: "Reset your Orbyte password",
          intro: "Someone (hopefully you) asked to reset your Orbyte password.",
          action: "Choose a new password",
          url,
          outro: "This link works once and expires in 1 hour. If you didn't ask for this, you can ignore this email; your password hasn't changed.",
        }),
      );
    },
    onPasswordReset: async ({ user }) => {
      await db.activityLog.create({ data: { ownerId: user.id, action: "account.password_reset", entityType: "user", entityId: user.id } });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24, // 24 hours
    sendVerificationEmail: async ({ user, url }) => {
      void sendSystemEmail(
        accountEmail({
          to: user.email,
          name: user.name,
          subject: "Verify your email for Orbyte",
          intro: "Confirm this is your email address to finish setting up your Orbyte account.",
          action: "Verify email",
          url,
          outro: "This link expires in 24 hours. If you didn't create an Orbyte account, you can ignore this email.",
        }),
      );
    },
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
      "/request-password-reset": { window: 300, max: 3 },
      "/reset-password": { window: 60, max: 5 },
      "/send-verification-email": { window: 300, max: 3 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/two-factor/enable": { window: 60, max: 5 },
      "/two-factor/disable": { window: 60, max: 5 },
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
  plugins: [
    // Authenticator-app (TOTP) codes, plus single-use backup codes. Secrets are encrypted at rest.
    twoFactor({ issuer: "Orbyte", skipVerificationOnEnable: false }),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
