import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resetDatabase } from "../support/db";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — what authenticator apps compute. */
function totp(base32: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of base32.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = crypto.createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const cookieFrom = (h: Headers) =>
  h
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.endsWith("="))
    .join("; ");
let n = 0;
const PASSWORD = "two-factor-password-1";

async function userWithTwoFactor() {
  const email = `tf${++n}-${Date.now()}@example.test`;
  const { headers } = await auth.api.signUpEmail({ body: { name: "TF", email, password: PASSWORD }, returnHeaders: true });
  const cookie = cookieFrom(headers);
  const setup = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers: new Headers({ cookie }) });
  if (!("totpURI" in setup)) throw new Error("expected TOTP setup");
  const secret = new URL(setup.totpURI).searchParams.get("secret")!;
  expect(new URL(setup.totpURI).searchParams.get("issuer")).toBe("Orbyte");
  // Not on until the first code is confirmed.
  expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ twoFactorEnabled: false });
  const confirmed = await auth.api.verifyTOTP({ body: { code: totp(secret) }, headers: new Headers({ cookie }), returnHeaders: true });
  expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ twoFactorEnabled: true });
  // Turning it on issues a fresh session cookie.
  return { email, secret, backupCodes: setup.backupCodes, cookie: cookieFrom(confirmed.headers) || cookie };
}

async function passwordStep(email: string) {
  const { headers, response } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
  return { response, cookie: cookieFrom(headers) };
}

beforeEach(resetDatabase);

describe("two-factor sign-in", () => {
  it("stores the secret encrypted and asks for a code after the password", async () => {
    const { email, secret } = await userWithTwoFactor();
    const row = await db.twoFactor.findFirstOrThrow({ where: { user: { email } } });
    expect(row.secret).not.toContain(secret);

    const { response, cookie } = await passwordStep(email);
    expect(response).toMatchObject({ twoFactorRedirect: true });
    expect(cookie).not.toMatch(/session_token=/); // no session yet

    await expect(auth.api.verifyTOTP({ body: { code: "000000" }, headers: new Headers({ cookie }) })).rejects.toThrow();
    const { headers } = await auth.api.verifyTOTP({ body: { code: totp(secret) }, headers: new Headers({ cookie }), returnHeaders: true });
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieFrom(headers) }) });
    expect(session?.user.email).toBe(email);
  });

  it("accepts each backup code once", async () => {
    const { email, backupCodes } = await userWithTwoFactor();
    expect(backupCodes.length).toBeGreaterThanOrEqual(8);
    const first = await passwordStep(email);
    await auth.api.verifyBackupCode({ body: { code: backupCodes[0] }, headers: new Headers({ cookie: first.cookie }) });
    const second = await passwordStep(email);
    await expect(auth.api.verifyBackupCode({ body: { code: backupCodes[0] }, headers: new Headers({ cookie: second.cookie }) })).rejects.toThrow();
  });

  it("needs the password to turn off", async () => {
    const { email, cookie } = await userWithTwoFactor();
    await expect(auth.api.disableTwoFactor({ body: { password: "wrong-password-000" }, headers: new Headers({ cookie }) })).rejects.toThrow();
    await auth.api.disableTwoFactor({ body: { password: PASSWORD }, headers: new Headers({ cookie }) });
    expect(await db.user.findUniqueOrThrow({ where: { email } })).toMatchObject({ twoFactorEnabled: false });
    expect((await passwordStep(email)).response).not.toHaveProperty("twoFactorRedirect");
  });
});
