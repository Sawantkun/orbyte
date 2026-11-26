import type { Readable } from "node:stream";

export type ByteRange = { start: number; end: number };

/** `size` is the full object size; `length` the bytes in `body` (differs for ranged reads). */
export type StoredObject = { body: Readable; size: number; length: number; contentType: string; range?: ByteRange };

/**
 * Binary object storage. Keys are opaque, server-generated and never sent to
 * clients; all access goes through authorised routes.
 */
export interface StorageAdapter {
  readonly kind: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Store a file from local disk without loading it into memory. */
  putFile(key: string, filePath: string, size: number, contentType: string): Promise<void>;
  /** Read an object, optionally a byte range (inclusive) for HTTP Range requests. */
  get(key: string, range?: ByteRange): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {}
