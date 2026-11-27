import { beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { testOutbox } from "@/server/system-mail";
import { resetDatabase } from "../support/db";

const flush = () => new Promise((r) => setTimeout(r, 20)); // emails are sent without awaiting
const linkIn = (text: string) => text.match(/https?:\/\/\S+/)![0];
let n = 0;

async function signUp() {
  const email = `mail${++n}-${Date.now()}@example.test`;
  const { headers } = await auth.api.signUpEmail({ body: { name: "Mail User", email, password: "original-password-1" }, returnHeaders: true });
  await flush();
  return { email, cookie: headers.get("set-cookie")!.split(";")[0] };
}

beforeEach(async () => {
  await resetDatabase();
  testOutbox.length = 0;
});

describe("email verification", () => {
  it("emails a verification link on sign-up that verifies the account", async () => {
    const { email } = await signUp();
    const mail = testOutbox.find((m) => m.to === email)!;
    expect(mail.subject).toBe("Verify your email for Orbyte");
    expect(mail.html).toContain("Verify email");
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ emailVerified: false });

    const res = await auth.handler(new Request(linkIn(mail.text)));
    expect([200, 302]).toContain(res.status);
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ emailVerified: true });
  });

  it("rejects a tampered verification link", async () => {
    const { email } = await signUp();
    const link = linkIn(testOutbox.find((m) => m.to === email)!.text).replace(/token=([^&]+)/, "token=$1x");
    await auth.handler(new Request(link));
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ emailVerified: false });
  });
});

describe("password reset", () => {
  it("emails a one-time link that sets a new password and signs out other devices", async () => {
    const { email, cookie } = await signUp();
    testOutbox.length = 0;
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    await flush();
    const mail = testOutbox.find((m) => m.to === email)!;
    expect(mail.subject).toBe("Reset your Orbyte password");
    // The link goes through the auth API, which redirects to our page with the token.
    const res = await auth.handler(new Request(linkIn(mail.text)));
    const location = new URL(res.headers.get("location")!, "http://localhost:3000");
    expect(location.pathname).toBe("/reset-password");
    const token = location.searchParams.get("token")!;

    await auth.api.resetPassword({ body: { newPassword: "brand-new-password-2", token } });
    await expect(auth.api.signInEmail({ body: { email, password: "original-password-1" } })).rejects.toThrow();
    await expect(auth.api.signInEmail({ body: { email, password: "brand-new-password-2" } })).resolves.toBeTruthy();
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull(); // old session revoked
    expect(await db.activityLog.count({ where: { action: "account.password_reset" } })).toBe(1);

    // The token works only once.
    await expect(auth.api.resetPassword({ body: { newPassword: "third-password-333", token } })).rejects.toThrow();
  });

  it("doesn't reveal whether an account exists", async () => {
    const r = await auth.api.requestPasswordReset({ body: { email: "nobody@example.test", redirectTo: "/reset-password" } });
    await flush();
    expect(r).toMatchObject({ status: true });
    expect(testOutbox).toEqual([]);
  });
});
