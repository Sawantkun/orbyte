import { describe, expect, it } from "vitest";
import { changePasswordSchema, loginSchema, profileSchema, signupSchema } from "@/lib/validation/auth";

describe("auth validation", () => {
  it("normalises email on signup", () => {
    const r = signupSchema.parse({ name: " Ada ", email: " Ada@Example.COM ", password: "0123456789" });
    expect(r).toEqual({ name: "Ada", email: "ada@example.com", password: "0123456789" });
  });

  it("rejects short passwords and bad emails", () => {
    expect(signupSchema.safeParse({ name: "A", email: "a@b.co", password: "short" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });

  it("rejects blank or overlong names", () => {
    expect(profileSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(profileSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });

  it("requires matching password confirmation", () => {
    const base = { currentPassword: "old", newPassword: "0123456789", revokeOtherSessions: true };
    expect(changePasswordSchema.safeParse({ ...base, confirmPassword: "0123456789" }).success).toBe(true);
    const bad = changePasswordSchema.safeParse({ ...base, confirmPassword: "different!!" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});
