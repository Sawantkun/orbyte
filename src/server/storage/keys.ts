import { randomBytes } from "node:crypto";

const SAFE_EXT = /^[a-z0-9]{1,10}$/;

/**
 * Storage keys: `<ownerId>/<yyyy>/<mm>/<random>[.<ext>]`. Random component
 * (128 bits) makes keys unguessable; the owner prefix keeps per-user data
 * grouped for lifecycle/deletion tooling. No user-controlled path segments.
 */
export function newStorageKey(ownerId: string, extension: string | null, now = new Date()): string {
  if (!/^[a-z0-9]{10,40}$/i.test(ownerId)) throw new Error("Invalid owner id for storage key");
  const ext = extension && SAFE_EXT.test(extension) ? `.${extension}` : "";
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${ownerId}/${yyyy}/${mm}/${randomBytes(16).toString("hex")}${ext}`;
}

export const thumbnailKeyFor = (key: string) => `${key.replace(/\.[a-z0-9]+$/, "")}.thumb.webp`;

/** Accept only keys produced by newStorageKey (defence in depth for the local adapter). */
export function isValidStorageKey(key: string): boolean {
  return /^[a-z0-9]{10,40}\/\d{4}\/\d{2}\/[a-f0-9]{32}(\.thumb\.webp|\.[a-z0-9]{1,10})?$/i.test(key);
}
