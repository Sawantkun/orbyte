import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, sealSecret, secretHint } from "@/server/crypto/secrets";

const ring = (entries: [number, Buffer][]) => new Map(entries);
const k1 = randomBytes(32);
const k2 = randomBytes(32);
const ctx = { ownerId: "user_a", provider: "openai" };

describe("secret sealing (AES-256-GCM)", () => {
  it("round-trips and never stores plaintext", () => {
    const sealed = sealSecret("sk-live-abcdef1234567890", ctx, ring([[1, k1]]), 1);
    expect(JSON.stringify(sealed)).not.toContain("abcdef1234567890");
    expect(openSecret(sealed, ctx, ring([[1, k1]]))).toBe("sk-live-abcdef1234567890");
  });

  it("uses a fresh IV each time", () => {
    const a = sealSecret("same", ctx, ring([[1, k1]]), 1);
    const b = sealSecret("same", ctx, ring([[1, k1]]), 1);
    expect(a.iv).not.toBe(b.iv);
    expect(a.encryptedSecret).not.toBe(b.encryptedSecret);
  });

  it("detects tampering and rejects ciphertext moved to another owner or provider", () => {
    const sealed = sealSecret("secret-value", ctx, ring([[1, k1]]), 1);
    const flipped = Buffer.from(sealed.encryptedSecret, "base64");
    flipped[0] ^= 1;
    expect(() => openSecret({ ...sealed, encryptedSecret: flipped.toString("base64") }, ctx, ring([[1, k1]]))).toThrow();
    expect(() => openSecret(sealed, { ownerId: "user_b", provider: "openai" }, ring([[1, k1]]))).toThrow();
    expect(() => openSecret(sealed, { ownerId: "user_a", provider: "anthropic" }, ring([[1, k1]]))).toThrow();
    expect(() => openSecret(sealed, ctx, ring([[1, k2]]))).toThrow();
  });

  it("decrypts old rows during rotation via the previous key version", () => {
    const old = sealSecret("rotate-me", ctx, ring([[1, k1]]), 1);
    const during = ring([[2, k2], [1, k1]]);
    expect(openSecret(old, ctx, during)).toBe("rotate-me");
    const resealed = sealSecret(openSecret(old, ctx, during), ctx, during, 2);
    expect(resealed.keyVersion).toBe(2);
    expect(openSecret(resealed, ctx, ring([[2, k2]]))).toBe("rotate-me");
  });

  it("hints show at most the last 4 characters", () => {
    expect(secretHint("sk-proj-1234567890abcd")).toBe("abcd");
    expect(secretHint("short")).toBe("••••");
  });
});
