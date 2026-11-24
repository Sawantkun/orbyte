import { beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resetDatabase } from "../support/db";

const creds = { name: "Ada Lovelace", email: "ada@example.test", password: "analytical-engine" };

describe("authentication (Better Auth + Prisma)", () => {
  beforeEach(resetDatabase);

  it("signs up a user, hashes the password and logs activity", async () => {
    const res = await auth.api.signUpEmail({ body: creds });
    expect(res.user.email).toBe(creds.email);

    const account = await db.account.findFirstOrThrow({ where: { userId: res.user.id, providerId: "credential" } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(creds.password);

    const activity = await db.activityLog.findMany({ where: { ownerId: res.user.id } });
    expect(activity.map((a) => a.action)).toEqual(["account.created"]);
  });

  it("rejects duplicate emails", async () => {
    await auth.api.signUpEmail({ body: creds });
    await expect(auth.api.signUpEmail({ body: creds })).rejects.toMatchObject({ status: "UNPROCESSABLE_ENTITY" });
  });

  it("rejects passwords below the minimum length", async () => {
    await expect(auth.api.signUpEmail({ body: { ...creds, password: "short" } })).rejects.toBeTruthy();
    expect(await db.user.count()).toBe(0);
  });

  it("signs in with the right password only", async () => {
    await auth.api.signUpEmail({ body: creds });
    const ok = await auth.api.signInEmail({ body: { email: creds.email, password: creds.password } });
    expect(ok.token).toBeTruthy();
    await expect(
      auth.api.signInEmail({ body: { email: creds.email, password: "wrong-password!" } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("resolves a session from a valid bearer cookie and nothing from a forged one", async () => {
    const { headers } = await auth.api.signUpEmail({ body: creds, returnHeaders: true });
    const cookie = headers.get("set-cookie")!.split(";")[0];
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe(creds.email);

    const forged = await auth.api.getSession({
      headers: new Headers({ cookie: "better-auth.session_token=forged.value" }),
    });
    expect(forged).toBeNull();
  });
});
