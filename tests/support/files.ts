import sharp from "sharp";

export const pngBytes = (w = 64, h = 48, color = "#8b5cf6") =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
export const jpegBytes = () => sharp({ create: { width: 32, height: 32, channels: 3, background: "#22c55e" } }).jpeg().toBuffer();
export const pdfBytes = () => Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
/** Windows PE header — must never be accepted under an image extension. */
export const exeBytes = () => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(58), Buffer.from([0x80, 0, 0, 0]), Buffer.alloc(64), Buffer.from("PE\0\0"), Buffer.alloc(200)]);
