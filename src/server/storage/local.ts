import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isValidStorageKey } from "./keys";
import { StorageError, type ByteRange, type StorageAdapter, type StoredObject } from "./types";

/** Development adapter: files under STORAGE_LOCAL_DIR, content type in a sidecar. */
export class LocalStorage implements StorageAdapter {
  readonly kind = "local" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    if (!isValidStorageKey(key)) throw new StorageError("Invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new StorageError("Invalid storage key");
    return full;
  }

  async put(key: string, body: Buffer, contentType: string) {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, { mode: 0o600 });
    await fs.writeFile(`${file}.meta`, JSON.stringify({ contentType }), { mode: 0o600 });
  }

  async putFile(key: string, filePath: string, _size: number, contentType: string) {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.copyFile(filePath, file);
    await fs.chmod(file, 0o600);
    await fs.writeFile(`${file}.meta`, JSON.stringify({ contentType }), { mode: 0o600 });
  }

  async get(key: string, range?: ByteRange): Promise<StoredObject | null> {
    const file = this.resolve(key);
    try {
      const [stat, meta] = await Promise.all([fs.stat(file), fs.readFile(`${file}.meta`, "utf8").catch(() => "{}")]);
      const contentType = (JSON.parse(meta) as { contentType?: string }).contentType ?? "application/octet-stream";
      if (range) {
        return { body: createReadStream(file, { start: range.start, end: range.end }), size: stat.size, length: range.end - range.start + 1, contentType, range };
      }
      return { body: createReadStream(file), size: stat.size, length: stat.size, contentType };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string) {
    const file = this.resolve(key);
    await Promise.all([fs.rm(file, { force: true }), fs.rm(`${file}.meta`, { force: true })]);
  }
}
