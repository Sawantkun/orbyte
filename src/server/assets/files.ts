import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { fileTypeFromBuffer, fileTypeFromFile } from "file-type";
import type { AssetKind } from "@/generated/prisma/client";

/**
 * Upload allowlist. The stored MIME type always comes from this table (never
 * from the browser). Binary formats must be confirmed by magic-byte sniffing;
 * text formats must be valid UTF-8 with no binary signature.
 */
type Rule = { mime: string; kind: AssetKind; sniff: readonly string[] | "text" };

const T = "text" as const;
export const ALLOWED: Record<string, Rule> = {
  // Images
  png: { mime: "image/png", kind: "IMAGE", sniff: ["image/png"] },
  jpg: { mime: "image/jpeg", kind: "IMAGE", sniff: ["image/jpeg"] },
  jpeg: { mime: "image/jpeg", kind: "IMAGE", sniff: ["image/jpeg"] },
  gif: { mime: "image/gif", kind: "IMAGE", sniff: ["image/gif"] },
  webp: { mime: "image/webp", kind: "IMAGE", sniff: ["image/webp"] },
  avif: { mime: "image/avif", kind: "IMAGE", sniff: ["image/avif"] },
  svg: { mime: "image/svg+xml", kind: "IMAGE", sniff: T },
  // Video
  mp4: { mime: "video/mp4", kind: "VIDEO", sniff: ["video/mp4"] },
  mov: { mime: "video/quicktime", kind: "VIDEO", sniff: ["video/quicktime"] },
  webm: { mime: "video/webm", kind: "VIDEO", sniff: ["video/webm"] },
  // Audio
  mp3: { mime: "audio/mpeg", kind: "AUDIO", sniff: ["audio/mpeg"] },
  wav: { mime: "audio/wav", kind: "AUDIO", sniff: ["audio/wav", "audio/vnd.wave", "audio/x-wav"] },
  ogg: { mime: "audio/ogg", kind: "AUDIO", sniff: ["audio/ogg", "audio/opus", "video/ogg"] },
  m4a: { mime: "audio/mp4", kind: "AUDIO", sniff: ["audio/x-m4a", "audio/mp4", "video/mp4"] },
  // Documents
  pdf: { mime: "application/pdf", kind: "PDF", sniff: ["application/pdf"] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "DOCUMENT", sniff: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "DOCUMENT", sniff: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "DOCUMENT", sniff: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"] },
  // Text & data
  txt: { mime: "text/plain", kind: "TEXT", sniff: T },
  md: { mime: "text/markdown", kind: "TEXT", sniff: T },
  csv: { mime: "text/csv", kind: "TEXT", sniff: T },
  json: { mime: "application/json", kind: "JSON", sniff: T },
  // Other
  zip: { mime: "application/zip", kind: "OTHER", sniff: ["application/zip"] },
};

// Code snippets: stored and served as text/plain — never executed or rendered as HTML.
for (const ext of ["js", "mjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "cs", "php", "sh", "sql", "yaml", "yml", "toml", "html", "css", "xml"]) {
  ALLOWED[ext] = { mime: "text/plain", kind: "CODE", sniff: T };
}

export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED).map((e) => `.${e}`).join(",");

export class UploadRejected extends Error {
  constructor(
    public readonly code: "UNSUPPORTED_TYPE" | "TYPE_MISMATCH" | "INVALID_CONTENT" | "EMPTY_FILE",
    message: string,
  ) {
    super(message);
  }
}

export function extensionOf(filename: string): string | null {
  const m = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return m ? m[1] : null;
}

/** Where an upload's bytes live: memory (tests, small payloads) or a temp file (streamed uploads). */
export type FileSource = {
  size: number;
  sniff(): Promise<{ mime: string } | undefined>;
  head(n: number): Promise<Buffer>;
  chunks(): AsyncIterable<Buffer>;
  text(): Promise<string>;
};

export const bufferSource = (buf: Buffer): FileSource => ({
  size: buf.length,
  sniff: () => fileTypeFromBuffer(buf),
  head: async (n) => buf.subarray(0, n),
  chunks: async function* () {
    yield buf;
  },
  text: async () => buf.toString("utf8"),
});

export const fileSource = (filePath: string, size: number): FileSource => ({
  size,
  sniff: () => fileTypeFromFile(filePath),
  head: async (n) => {
    const fh = await fs.open(filePath, "r");
    try {
      const out = Buffer.alloc(Math.min(n, size));
      await fh.read(out, 0, out.length, 0);
      return out;
    } finally {
      await fh.close();
    }
  },
  chunks: () => createReadStream(filePath, { highWaterMark: 64 * 1024 }),
  text: () => fs.readFile(filePath, "utf8"),
});

/** Streaming UTF-8 validation: no NUL bytes, no invalid sequences. */
async function isUtf8Text(src: FileSource): Promise<boolean> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const chunk of src.chunks()) {
      if (chunk.includes(0)) return false;
      decoder.decode(chunk, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

export type ClassifiedFile = { extension: string; mimeType: string; kind: AssetKind };

export async function classifySource(filename: string, src: FileSource): Promise<ClassifiedFile> {
  if (src.size === 0) throw new UploadRejected("EMPTY_FILE", "The file is empty.");
  const extension = extensionOf(filename);
  const rule = extension ? ALLOWED[extension] : undefined;
  if (!extension || !rule) throw new UploadRejected("UNSUPPORTED_TYPE", `Files of type ${extension ? `.${extension}` : "(no extension)"} aren't supported.`);

  const sniffed = await src.sniff();
  if (rule.sniff === "text") {
    if (sniffed || !(await isUtf8Text(src))) throw new UploadRejected("TYPE_MISMATCH", `The file content doesn't match .${extension}.`);
    if (extension === "json") {
      try {
        JSON.parse(await src.text());
      } catch {
        throw new UploadRejected("INVALID_CONTENT", "The file isn't valid JSON.");
      }
    }
    if (extension === "svg" && !/<svg[\s>]/i.test((await src.head(4096)).toString("utf8"))) {
      throw new UploadRejected("INVALID_CONTENT", "The file isn't a valid SVG.");
    }
  } else if (!sniffed || !rule.sniff.includes(sniffed.mime)) {
    throw new UploadRejected("TYPE_MISMATCH", `The file content doesn't match .${extension}.`);
  }
  return { extension, mimeType: rule.mime, kind: rule.kind };
}

export const classifyUpload = (filename: string, buf: Buffer) => classifySource(filename, bufferSource(buf));

/** Kind for workflow-generated content where we choose the MIME type ourselves. */
export function kindForMime(mime: string): AssetKind {
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  if (mime === "application/pdf") return "PDF";
  if (mime === "application/json") return "JSON";
  if (mime.startsWith("text/")) return "TEXT";
  return "OTHER";
}

/** Types safe to render inline in the browser (with a sandbox CSP); everything else downloads. */
export function isInlineSafe(mime: string): boolean {
  return /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|wav|ogg|mp4)|application\/pdf)$/.test(mime);
}

export function isTextPreviewable(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "image/svg+xml";
}
