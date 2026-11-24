import type { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { isValidStorageKey } from "./keys";
import { StorageError, type StorageAdapter, type StoredObject } from "./types";

export type S3Config = { bucket: string; region: string; accessKeyId: string; secretAccessKey: string; endpoint?: string };

/** S3-compatible adapter (AWS S3, Cloudflare R2, MinIO, …). Objects are private; the app streams them to authorised users. */
export class S3Storage implements StorageAdapter {
  readonly kind = "s3" as const;
  constructor(
    private readonly config: S3Config,
    private readonly client: Pick<S3Client, "send"> = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: Boolean(config.endpoint), // most S3-compatible services need path-style
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
  ) {}

  private check(key: string) {
    if (!isValidStorageKey(key)) throw new StorageError("Invalid storage key");
  }

  async put(key: string, body: Buffer, contentType: string) {
    this.check(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string): Promise<StoredObject | null> {
    this.check(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      if (!res.Body) return null;
      return { body: res.Body as Readable, size: res.ContentLength ?? 0, contentType: res.ContentType ?? "application/octet-stream" };
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async delete(key: string) {
    this.check(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}
