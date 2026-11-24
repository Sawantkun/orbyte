import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * AES-256-GCM envelope for user-supplied credentials.
 *
 * - 96-bit random IV per encryption; 128-bit auth tag (tamper detection).
 * - Additional authenticated data binds a ciphertext to its owner and
 *   provider, so a row copied onto another user/provider fails to decrypt.
 * - `keyVersion` supports rotation: ENCRYPTION_KEY is the current key
 *   (version ENCRYPTION_KEY_VERSION); ENCRYPTION_KEY_PREVIOUS decrypts rows
 *   still on the previous version until `pnpm secrets:rotate` re-encrypts them.
 */
export type Sealed = { encryptedSecret: string; iv: string; authTag: string; keyVersion: number };

type Keyring = Map<number, Buffer>;

export function keyringFromEnv(): Keyring {
  const ring: Keyring = new Map([[env.ENCRYPTION_KEY_VERSION, Buffer.from(env.ENCRYPTION_KEY, "base64")]]);
  if (env.ENCRYPTION_KEY_PREVIOUS) ring.set(env.ENCRYPTION_KEY_VERSION - 1, Buffer.from(env.ENCRYPTION_KEY_PREVIOUS, "base64"));
  return ring;
}

const aad = (ownerId: string, provider: string) => Buffer.from(`orbyte:integration:v1:${ownerId}:${provider}`);

export class SecretDecryptionError extends Error {
  constructor() {
    super("Stored credential could not be decrypted");
    this.name = "SecretDecryptionError";
  }
}

export function sealSecret(plaintext: string, ctx: { ownerId: string; provider: string }, ring: Keyring = keyringFromEnv(), version = env.ENCRYPTION_KEY_VERSION): Sealed {
  const key = ring.get(version);
  if (!key || key.length !== 32) throw new Error("Encryption key unavailable");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(ctx.ownerId, ctx.provider));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { encryptedSecret: encrypted.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: version };
}

export function openSecret(sealed: Sealed, ctx: { ownerId: string; provider: string }, ring: Keyring = keyringFromEnv()): string {
  const key = ring.get(sealed.keyVersion);
  if (!key) throw new SecretDecryptionError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(aad(ctx.ownerId, ctx.provider));
    decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.encryptedSecret, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretDecryptionError();
  }
}

/** "sk-…abcd" style hint: never more than the last 4 characters. */
export function secretHint(secret: string): string {
  const s = secret.trim();
  return s.length <= 8 ? "••••" : s.slice(-4);
}
