import "server-only";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { AppError } from "../errors";

export type ParsedUpload = {
  file: { path: string; size: number; filename: string };
  fields: Record<string, string>;
};

/**
 * Stream a multipart/form-data request to `dir` without buffering the file in
 * memory. Accepts one file (field "file") plus a few small text fields; the
 * size limit is enforced while streaming, so oversized uploads stop early.
 */
export async function parseMultipartUpload(req: Request, dir: string, maxBytes: number): Promise<ParsedUpload> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data") || !req.body) {
    throw new AppError(400, "INVALID_FORM", "Expected a multipart form upload.");
  }

  let busboy: Busboy.Busboy;
  try {
    busboy = Busboy({
      headers: { "content-type": contentType },
      limits: { files: 1, fileSize: maxBytes, fields: 10, fieldSize: 4096, parts: 12 },
    });
  } catch {
    throw new AppError(400, "INVALID_FORM", "Expected a multipart form upload.");
  }

  const fields: Record<string, string> = {};
  let file: ParsedUpload["file"] | null = null;
  let tooLarge = false;
  const writes: Promise<void>[] = [];

  busboy.on("field", (name, value) => {
    fields[name] = value;
  });
  busboy.on("file", (name, stream, info) => {
    if (name !== "file" || file) {
      stream.resume(); // ignore unexpected or extra files
      return;
    }
    const target = path.join(dir, "upload.bin");
    const entry = { path: target, size: 0, filename: info.filename ?? "upload" };
    file = entry;
    stream.on("data", (chunk: Buffer) => {
      entry.size += chunk.length;
    });
    stream.on("limit", () => {
      tooLarge = true;
    });
    writes.push(pipeline(stream, createWriteStream(target, { mode: 0o600 })));
  });

  try {
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), busboy);
    await Promise.all(writes);
  } catch {
    if (tooLarge) throw tooLargeError(maxBytes);
    throw new AppError(400, "INVALID_FORM", "The upload could not be read.");
  }
  if (tooLarge) throw tooLargeError(maxBytes);
  if (!file) throw new AppError(400, "FILE_REQUIRED", "Choose a file to upload.");
  return { file, fields };
}

export const tooLargeError = (maxBytes: number) => new AppError(413, "FILE_TOO_LARGE", `Files can be at most ${Math.round(maxBytes / 1024 / 1024)} MB.`);
