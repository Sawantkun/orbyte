import { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3Storage } from "@/server/storage/s3";

const KEY = "cmwv2m6oz0000bxxn5ge7tgs8/2026/11/0123456789abcdef0123456789abcdef.png";

function fakeClient(respond: (cmd: unknown) => unknown) {
  const sent: unknown[] = [];
  return { sent, client: { send: async (cmd: unknown) => (sent.push(cmd), respond(cmd)) } as never };
}

describe("S3Storage (S3-compatible adapter)", () => {
  const config = { bucket: "orbyte-assets", region: "auto", accessKeyId: "k", secretAccessKey: "s", endpoint: "https://r2.example" };

  it("puts, gets and deletes private objects by key", async () => {
    const { sent, client } = fakeClient((cmd) =>
      cmd instanceof GetObjectCommand ? { Body: Readable.from([Buffer.from("hi")]), ContentLength: 2, ContentType: "image/png" } : {},
    );
    const s3 = new S3Storage(config, client);
    await s3.put(KEY, Buffer.from("hi"), "image/png");
    const obj = await s3.get(KEY);
    await s3.delete(KEY);
    expect(sent[0]).toBeInstanceOf(PutObjectCommand);
    expect((sent[0] as PutObjectCommand).input).toMatchObject({ Bucket: "orbyte-assets", Key: KEY, ContentType: "image/png" });
    expect((sent[0] as PutObjectCommand).input).not.toHaveProperty("ACL");
    expect(obj).toMatchObject({ size: 2, contentType: "image/png" });
    expect(sent[2]).toBeInstanceOf(DeleteObjectCommand);
  });

  it("returns null for missing objects and refuses invalid keys", async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
    });
    const s3 = new S3Storage(config, client);
    expect(await s3.get(KEY)).toBeNull();
    await expect(s3.put("../escape", Buffer.from("x"), "text/plain")).rejects.toThrow("Invalid storage key");
  });
});
