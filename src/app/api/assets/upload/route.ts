import { env } from "@/lib/env";
import { ok, withUser } from "@/server/api";
import { classifyUpload, UploadRejected } from "@/server/assets/files";
import { createAsset } from "@/server/assets/service";
import { AppError } from "@/server/errors";

/**
 * multipart/form-data: file (required), collectionId?, tags? (comma-separated), description?
 * One file per request; the client uploads several in parallel with progress.
 */
export const POST = withUser(async (req, { user }) => {
  // Reject oversized bodies before buffering them.
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > env.MAX_UPLOAD_BYTES + 64 * 1024) throw tooLarge();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError(400, "INVALID_FORM", "Expected a multipart form upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "FILE_REQUIRED", "Choose a file to upload.");
  if (file.size > env.MAX_UPLOAD_BYTES) throw tooLarge();

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 200) || "upload";
  let classified;
  try {
    classified = await classifyUpload(filename, buffer);
  } catch (e) {
    if (e instanceof UploadRejected) throw new AppError(e.code === "UNSUPPORTED_TYPE" ? 415 : 422, e.code, e.message);
    throw e;
  }

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const asset = await createAsset(user.id, {
    name: filename,
    buffer,
    ...classified,
    source: "UPLOAD",
    description: str("description")?.slice(0, 2000),
    collectionId: str("collectionId"),
    tags: str("tags")?.split(",") ?? [],
  });
  return ok(asset, { status: 201 });
});

const tooLarge = () => new AppError(413, "FILE_TOO_LARGE", `Files can be at most ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
