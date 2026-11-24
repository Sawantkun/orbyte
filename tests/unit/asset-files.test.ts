import { describe, expect, it } from "vitest";
import { classifyUpload, extensionOf, kindForMime } from "@/server/assets/files";
import { contentDisposition } from "@/server/assets/http";
import { normalizeTags } from "@/server/assets/service";
import { isValidStorageKey, newStorageKey, thumbnailKeyFor } from "@/server/storage/keys";
import { exeBytes, jpegBytes, pdfBytes, pngBytes } from "../support/files";

describe("classifyUpload", () => {
  it("accepts files whose bytes match their extension, using our canonical MIME type", async () => {
    expect(await classifyUpload("Photo.PNG", await pngBytes())).toEqual({ extension: "png", mimeType: "image/png", kind: "IMAGE" });
    expect(await classifyUpload("a.jpeg", await jpegBytes())).toMatchObject({ mimeType: "image/jpeg" });
    expect(await classifyUpload("doc.pdf", pdfBytes())).toMatchObject({ kind: "PDF" });
    expect(await classifyUpload("notes.md", Buffer.from("# Hi\nthere"))).toMatchObject({ mimeType: "text/markdown", kind: "TEXT" });
    expect(await classifyUpload("data.json", Buffer.from('{"a":1}'))).toMatchObject({ kind: "JSON" });
    expect(await classifyUpload("app.ts", Buffer.from("export const x = 1;"))).toEqual({ extension: "ts", mimeType: "text/plain", kind: "CODE" });
    expect(await classifyUpload("page.html", Buffer.from("<script>alert(1)</script>"))).toMatchObject({ mimeType: "text/plain", kind: "CODE" });
    expect(await classifyUpload("logo.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toMatchObject({ mimeType: "image/svg+xml" });
  });

  it.each([
    ["malware.exe", "UNSUPPORTED_TYPE"],
    ["no-extension", "UNSUPPORTED_TYPE"],
  ])("rejects %s", async (name, code) => {
    await expect(classifyUpload(name, Buffer.from("x"))).rejects.toMatchObject({ code });
  });

  it("rejects content that does not match the extension", async () => {
    await expect(classifyUpload("cat.png", exeBytes())).rejects.toMatchObject({ code: "TYPE_MISMATCH" });
    await expect(classifyUpload("cat.png", Buffer.from("just text"))).rejects.toMatchObject({ code: "TYPE_MISMATCH" });
    await expect(classifyUpload("notes.txt", await pngBytes())).rejects.toMatchObject({ code: "TYPE_MISMATCH" });
    await expect(classifyUpload("notes.txt", Buffer.from([0x68, 0x00, 0x69]))).rejects.toMatchObject({ code: "TYPE_MISMATCH" });
    await expect(classifyUpload("photo.jpg", await pngBytes())).rejects.toMatchObject({ code: "TYPE_MISMATCH" });
  });

  it("rejects invalid JSON/SVG and empty files", async () => {
    await expect(classifyUpload("x.json", Buffer.from("{nope"))).rejects.toMatchObject({ code: "INVALID_CONTENT" });
    await expect(classifyUpload("x.svg", Buffer.from("<html></html>"))).rejects.toMatchObject({ code: "INVALID_CONTENT" });
    await expect(classifyUpload("x.txt", Buffer.alloc(0))).rejects.toMatchObject({ code: "EMPTY_FILE" });
  });

  it("helpers", () => {
    expect(extensionOf("archive.tar.GZ")).toBe("gz");
    expect(kindForMime("image/png")).toBe("IMAGE");
    expect(kindForMime("application/json")).toBe("JSON");
  });
});

describe("storage keys", () => {
  it("generates unguessable, owner-scoped keys and rejects anything else", () => {
    const k = newStorageKey("cmwv2m6oz0000bxxn5ge7tgs8", "png", new Date("2026-03-05T00:00:00Z"));
    expect(k).toMatch(/^cmwv2m6oz0000bxxn5ge7tgs8\/2026\/03\/[a-f0-9]{32}\.png$/);
    expect(isValidStorageKey(k)).toBe(true);
    expect(isValidStorageKey(thumbnailKeyFor(k))).toBe(true);
    for (const bad of ["../etc/passwd", "cmwv2m6oz0000bxxn5ge7tgs8/2026/03/../../x", "/abs/path", "a/b/c"]) expect(isValidStorageKey(bad)).toBe(false);
    expect(() => newStorageKey("../evil", "png")).toThrow();
    expect(newStorageKey("cmwv2m6oz0000bxxn5ge7tgs8", "p/ng")).not.toContain("/ng");
  });
});

describe("tags & headers", () => {
  it("normalises tags", () => {
    expect(normalizeTags([" Hero Image ", "hero-image", "Q4!", ""])).toEqual(["hero-image", "q4"]);
    expect(() => normalizeTags(Array.from({ length: 21 }, (_, i) => `t${i}`))).toThrow();
  });
  it("builds safe Content-Disposition headers", () => {
    expect(contentDisposition("attachment", 'rés"umé.pdf')).toBe(`attachment; filename="r_s_um_.pdf"; filename*=UTF-8''r%C3%A9s%22um%C3%A9.pdf`);
  });
});
