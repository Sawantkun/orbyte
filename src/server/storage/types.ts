import type { Readable } from "node:stream";

export type StoredObject = { body: Readable; size: number; contentType: string };

/**
 * Binary object storage. Keys are opaque, server-generated and never sent to
 * clients; all access goes through authorised routes.
 */
export interface StorageAdapter {
  readonly kind: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {}
