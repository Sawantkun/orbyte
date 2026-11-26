import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import { ok, withUser } from "@/server/api";
import { classifySource, fileSource, UploadRejected } from "@/server/assets/files";
import { parseMultipartUpload, tooLargeError } from "@/server/assets/multipart";
import { createAsset } from "@/server/assets/service";
import { AppError } from "@/server/errors";

/**
 * multipart/form-data: file (required), collectionId?, tags? (comma-separated), description?
 * One file per request; the client uploads several in parallel with progress.
 * The body is streamed to a private temp directory, never buffered in memory.
 */
export const POST = withUser(
  async (req, { user }) => {
    // Reject obviously oversized bodies before reading anything.
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > env.MAX_UPLOAD_BYTES + 64 * 1024) throw tooLargeError(env.MAX_UPLOAD_BYTES);

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbyte-upload-"));
    try {
      const { file, fields } = await parseMultipartUpload(req, dir, env.MAX_UPLOAD_BYTES);
      const filename = file.filename.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "upload";

      let classified;
      try {
        classified = await classifySource(filename, fileSource(file.path, file.size));
      } catch (e) {
        if (e instanceof UploadRejected) throw new AppError(e.code === "UNSUPPORTED_TYPE" ? 415 : 422, e.code, e.message);
        throw e;
      }

      const str = (k: string) => (fields[k]?.trim() ? fields[k].trim() : undefined);
      const asset = await createAsset(user.id, {
        name: filename,
        file: { path: file.path, size: file.size },
        ...classified,
        source: "UPLOAD",
        description: str("description")?.slice(0, 2000),
        collectionId: str("collectionId"),
        tags: str("tags")?.split(",") ?? [],
      });
      return ok(asset, { status: 201 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
  { limit: "upload" },
);
