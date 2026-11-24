import "server-only";
import { env } from "@/lib/env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { StorageAdapter } from "./types";

let instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (instance) return instance;
  instance =
    env.STORAGE_PROVIDER === "s3"
      ? new S3Storage({
          bucket: env.STORAGE_BUCKET!,
          region: env.STORAGE_REGION!,
          accessKeyId: env.STORAGE_ACCESS_KEY!,
          secretAccessKey: env.STORAGE_SECRET_KEY!,
          endpoint: env.STORAGE_ENDPOINT,
        })
      : new LocalStorage(env.STORAGE_LOCAL_DIR);
  return instance;
}

/** Tests swap in an isolated adapter. */
export function setStorageForTests(adapter: StorageAdapter | null) {
  instance = adapter;
}

export { newStorageKey, thumbnailKeyFor } from "./keys";
export type { StorageAdapter } from "./types";
