import "server-only";
import { Readable } from "node:stream";
import { isInlineSafe, isTextPreviewable } from "./files";
import type { openAssetContent } from "./service";

type Content = Awaited<ReturnType<typeof openAssetContent>>;

/** RFC 6266/5987 filename for Content-Disposition. */
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Serve user content safely. Everything gets nosniff and a locked-down CSP
 * with `sandbox` (scripts never run, even in an SVG opened directly), except
 * PDF whose built-in viewer cannot run sandboxed. Text-like types are always
 * served as text/plain so uploaded HTML/JS is never interpreted.
 */
export function contentResponse(c: Content, mode: "inline" | "attachment", cacheSeconds: number): Response {
  let type = c.mimeType;
  let disposition = mode;
  if (isTextPreviewable(type) && type !== "image/svg+xml") type = "text/plain; charset=utf-8";
  if (mode === "inline" && !isInlineSafe(c.mimeType) && c.mimeType !== "image/svg+xml" && !isTextPreviewable(c.mimeType)) disposition = "attachment";

  const csp =
    c.mimeType === "application/pdf"
      ? "default-src 'none'; object-src 'self'; frame-ancestors 'self'"
      : "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox";

  return new Response(Readable.toWeb(c.body) as ReadableStream, {
    status: c.range ? 206 : 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(c.length),
      "Accept-Ranges": "bytes",
      ...(c.range ? { "Content-Range": `bytes ${c.range.start}-${c.range.end}/${c.size}` } : {}),
      "Content-Disposition": contentDisposition(disposition, c.name),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": csp,
      "Cache-Control": `private, max-age=${cacheSeconds}`,
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
