import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as list from "@/app/api/assets/route";
import * as upload from "@/app/api/assets/upload/route";
import * as item from "@/app/api/assets/[id]/route";
import * as content from "@/app/api/assets/[id]/content/route";
import * as download from "@/app/api/assets/[id]/download/route";
import * as bulk from "@/app/api/assets/bulk/route";
import * as tags from "@/app/api/tags/route";
import * as collections from "@/app/api/collections/route";
import * as collection from "@/app/api/collections/[id]/route";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { json, params, request, signedInUser } from "../support/api";
import { resetDatabase } from "../support/db";
import { exeBytes, pdfBytes, pngBytes } from "../support/files";

const storageRoot = process.env.STORAGE_LOCAL_DIR!;
const stored = (key: string) => fs.existsSync(path.join(storageRoot, key));

async function uploadFile(cookie: string, name: string, bytes: Buffer, fields: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const req = new NextRequest(new URL("/api/assets/upload", "http://localhost:3000"), { method: "POST", headers: { cookie }, body: form });
  return upload.POST(req, {} as never);
}

const listAssets = async (cookie: string, qs = "") => (await json(await list.GET(request(`/api/assets${qs}`, { cookie }), {} as never))).data as { id: string; name: string; tags: string[] }[];

beforeEach(resetDatabase);

describe("asset upload", () => {
  it("stores the file and a thumbnail, records metadata and activity", async () => {
    const { cookie, id: ownerId } = await signedInUser();
    const res = await uploadFile(cookie, "hero.png", await pngBytes(800, 600), { tags: "Hero, Website", description: "Landing hero" });
    expect(res.status).toBe(201);
    const asset = (await res.json()).data;
    expect(asset).toMatchObject({ name: "hero.png", kind: "IMAGE", mimeType: "image/png", source: "UPLOAD", hasThumbnail: true, tags: ["hero", "website"] });

    const row = await db.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.storageKey.startsWith(`${ownerId}/`)).toBe(true);
    expect(stored(row.storageKey)).toBe(true);
    expect(stored(row.thumbnailKey!)).toBe(true);
    expect(row.metadata).toMatchObject({ width: 800, height: 600 });
    expect(row.description).toBe("Landing hero");
    expect(await db.activityLog.count({ where: { ownerId, action: "asset.uploaded" } })).toBe(1);
    // The storage key is never exposed.
    expect(JSON.stringify(asset)).not.toContain(row.storageKey);
  });

  it("rejects unsupported, disguised, oversized and unauthenticated uploads", async () => {
    const { cookie } = await signedInUser();
    const filesBefore = fs.existsSync(storageRoot) ? fs.readdirSync(storageRoot, { recursive: true }).length : 0;
    expect((await uploadFile(cookie, "run.exe", exeBytes())).status).toBe(415);
    const disguised = await uploadFile(cookie, "cat.png", exeBytes());
    expect(disguised.status).toBe(422);
    expect((await disguised.json()).error.code).toBe("TYPE_MISMATCH");
    expect((await uploadFile(cookie, "big.txt", Buffer.alloc(2 * 1024 * 1024 + 1, 97))).status).toBe(413);
    expect((await uploadFile("", "a.txt", Buffer.from("hi"))).status).toBe(401);
    expect(await db.asset.count()).toBe(0);
    // Rejected uploads leave nothing behind in storage.
    expect(fs.existsSync(storageRoot) ? fs.readdirSync(storageRoot, { recursive: true }).length : 0).toBe(filesBefore);
  });

  it("refuses uploads into another user's collection", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    const c = (await json(await collections.POST(request("/api/collections", { method: "POST", cookie: alice.cookie, body: { name: "Private" } }), {} as never))).data;
    expect((await uploadFile(bob.cookie, "x.txt", Buffer.from("hi"), { collectionId: c.id })).status).toBe(404);
  });
});

describe("serving content", () => {
  it("serves previews and downloads with hardened headers, only to the owner", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    const img = (await (await uploadFile(alice.cookie, "pic.png", await pngBytes())).json()).data;
    const html = (await (await uploadFile(alice.cookie, "page.html", Buffer.from("<script>alert(1)</script>"))).json()).data;
    const pdf = (await (await uploadFile(alice.cookie, "doc.pdf", pdfBytes())).json()).data;

    const thumb = await content.GET(request(`/api/assets/${img.id}/content?variant=thumbnail`, { cookie: alice.cookie }), params({ id: img.id }));
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/webp");
    expect(thumb.headers.get("content-security-policy")).toContain("sandbox");
    expect(thumb.headers.get("x-content-type-options")).toBe("nosniff");

    // Uploaded HTML is never rendered as HTML.
    const h = await content.GET(request(`/api/assets/${html.id}/content`, { cookie: alice.cookie }), params({ id: html.id }));
    expect(h.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(h.headers.get("content-security-policy")).toContain("sandbox");
    expect(await h.text()).toBe("<script>alert(1)</script>");

    const p = await content.GET(request(`/api/assets/${pdf.id}/content`, { cookie: alice.cookie }), params({ id: pdf.id }));
    expect(p.headers.get("content-type")).toBe("application/pdf");
    expect(p.headers.get("content-disposition")).toMatch(/^inline/);

    const d = await download.GET(request(`/api/assets/${img.id}/download`, { cookie: alice.cookie }), params({ id: img.id }));
    expect(d.headers.get("content-disposition")).toMatch(/^attachment; filename="pic.png"/);
    expect(Buffer.from(await d.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");

    for (const r of [
      await content.GET(request(`/api/assets/${img.id}/content`, { cookie: bob.cookie }), params({ id: img.id })),
      await download.GET(request(`/api/assets/${img.id}/download`, { cookie: bob.cookie }), params({ id: img.id })),
      await item.GET(request(`/api/assets/${img.id}`, { cookie: bob.cookie }), params({ id: img.id })),
    ]) {
      expect(r.status).toBe(404);
    }
    expect((await download.GET(request(`/api/assets/${img.id}/download`), params({ id: img.id }))).status).toBe(401);
  });
});

describe("library queries", () => {
  it("searches names, descriptions, tags, prompts and workflow names; filters and sorts", async () => {
    const { cookie, id: ownerId } = await signedInUser();
    await uploadFile(cookie, "alpha.txt", Buffer.from("a"), { tags: "campaign" });
    await uploadFile(cookie, "beta.json", Buffer.from("{}"), { description: "purple dashboard mock" });
    await uploadFile(cookie, "gamma.png", await pngBytes());
    const wf = await db.workflow.create({ data: { ownerId, name: "Website hero generator", definition: {} } });
    const gen = await uploadFile(cookie, "delta.png", await pngBytes());
    const genId = (await gen.json()).data.id;
    await db.asset.update({ where: { id: genId }, data: { workflowId: wf.id, source: "WORKFLOW", originalPrompt: "A futuristic skyline at dusk" } });

    const names = async (qs: string) => (await listAssets(cookie, qs)).map((a) => a.name).sort();
    expect(await names("?q=CAMPAIGN")).toEqual(["alpha.txt"]);
    expect(await names("?q=purple")).toEqual(["beta.json"]);
    expect(await names("?q=skyline")).toEqual(["delta.png"]);
    expect(await names("?q=hero%20gen")).toEqual(["delta.png"]);
    expect(await names("?kinds=IMAGE")).toEqual(["delta.png", "gamma.png"]);
    expect(await names("?kinds=TEXT,JSON")).toEqual(["alpha.txt", "beta.json"]);
    expect(await names("?source=WORKFLOW")).toEqual(["delta.png"]);
    expect(await names(`?workflowId=${wf.id}`)).toEqual(["delta.png"]);
    expect(await names("?tag=campaign")).toEqual(["alpha.txt"]);
    expect((await listAssets(cookie, "?sort=name")).map((a) => a.name)).toEqual(["alpha.txt", "beta.json", "delta.png", "gamma.png"]);
    const today = new Date().toISOString().slice(0, 10);
    expect((await listAssets(cookie, `?from=${today}&to=${today}`)).length).toBe(4);
    expect((await listAssets(cookie, "?from=2000-01-01&to=2000-01-02")).length).toBe(0);

    const page1 = await json(await list.GET(request("/api/assets?limit=3", { cookie }), {} as never));
    const page2 = await json(await list.GET(request(`/api/assets?limit=3&cursor=${page1.meta.nextCursor}`, { cookie }), {} as never));
    expect(page1.data.length + page2.data.length).toBe(4);
    expect(page2.meta.nextCursor).toBeNull();

    expect((await list.GET(request("/api/assets?kinds=BOGUS", { cookie }), {} as never)).status).toBe(400);
    const otherUser = await signedInUser("Other");
    expect(await listAssets(otherUser.cookie)).toEqual([]);
  });
});

describe("editing, bulk actions and deletion", () => {
  it("updates metadata and replaces tags", async () => {
    const { cookie } = await signedInUser();
    const a = (await (await uploadFile(cookie, "x.txt", Buffer.from("x"), { tags: "old,keep" })).json()).data;
    const res = await item.PATCH(
      request(`/api/assets/${a.id}`, { method: "PATCH", cookie, body: { name: "Renamed", description: "New", tags: ["keep", "New Tag"], isFavorite: true } }),
      params({ id: a.id }),
    );
    expect((await res.json()).data).toMatchObject({ name: "Renamed", description: "New", tags: ["keep", "new-tag"], isFavorite: true });
    expect((await json(await tags.GET(request("/api/tags", { cookie }), {} as never))).data.map((t: { name: string }) => t.name)).toEqual(["keep", "new-tag"]);
  });

  it("bulk operations affect only the caller's assets", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    const mine = [];
    for (const n of ["a.txt", "b.txt"]) mine.push((await (await uploadFile(alice.cookie, n, Buffer.from(n))).json()).data.id);
    const theirs = (await (await uploadFile(bob.cookie, "c.txt", Buffer.from("c"))).json()).data.id;
    const ids = [...mine, theirs];
    const c = (await json(await collections.POST(request("/api/collections", { method: "POST", cookie: alice.cookie, body: { name: "Campaign" } }), {} as never))).data;

    const run = async (op: unknown) => (await json(await bulk.POST(request("/api/assets/bulk", { method: "POST", cookie: alice.cookie, body: { ids, op } }), {} as never))).data;
    expect(await run({ action: "addTags", tags: ["q4"] })).toEqual({ affected: 2 });
    expect(await run({ action: "favorite", value: true })).toEqual({ affected: 2 });
    expect(await run({ action: "move", collectionId: c.id })).toEqual({ affected: 2 });
    const bobAsset = await db.asset.findUniqueOrThrow({ where: { id: theirs }, include: { tags: true } });
    expect(bobAsset).toMatchObject({ isFavorite: false, collectionId: null });
    expect(bobAsset.tags).toHaveLength(0);
    expect((await listAssets(alice.cookie, `?collectionId=${c.id}&favorite=true&tag=q4`)).length).toBe(2);

    expect(await run({ action: "removeTags", tags: ["q4"] })).toEqual({ affected: 2 });
    const keys = (await db.asset.findMany({ where: { id: { in: mine } } })).map((r) => r.storageKey);
    expect(await run({ action: "delete" })).toEqual({ affected: 2 });
    expect(await db.asset.count({ where: { id: { in: mine } } })).toBe(0);
    expect(keys.every((k) => !stored(k))).toBe(true);
    expect(await db.asset.count({ where: { id: theirs } })).toBe(1);
  });

  it("deleting one asset removes its stored files; other users get 404", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    const a = (await (await uploadFile(alice.cookie, "p.png", await pngBytes())).json()).data;
    const row = await db.asset.findUniqueOrThrow({ where: { id: a.id } });
    expect((await item.DELETE(request(`/api/assets/${a.id}`, { method: "DELETE", cookie: bob.cookie }), params({ id: a.id }))).status).toBe(404);
    expect((await item.DELETE(request(`/api/assets/${a.id}`, { method: "DELETE", cookie: alice.cookie }), params({ id: a.id }))).status).toBe(204);
    expect(stored(row.storageKey)).toBe(false);
    expect(stored(row.thumbnailKey!)).toBe(false);
  });
});

describe("collections", () => {
  it("CRUD with counts and covers; deleting a collection keeps its assets", async () => {
    const { cookie } = await signedInUser();
    const create = (name: string) => collections.POST(request("/api/collections", { method: "POST", cookie, body: { name } }), {} as never);
    const c = (await (await create("Website Assets")).json()).data;
    expect((await create("Website Assets")).status).toBe(409);

    const img = (await (await uploadFile(cookie, "cover.png", await pngBytes(), { collectionId: c.id })).json()).data;
    await uploadFile(cookie, "notes.txt", Buffer.from("n"), { collectionId: c.id });

    const listed = (await json(await collections.GET(request("/api/collections?q=website", { cookie }), {} as never))).data;
    expect(listed).toEqual([expect.objectContaining({ id: c.id, assetCount: 2, coverAssetId: img.id })]);

    const renamed = await collection.PATCH(request(`/api/collections/${c.id}`, { method: "PATCH", cookie, body: { name: "Site", description: "All site files" } }), params({ id: c.id }));
    expect((await renamed.json()).data).toMatchObject({ name: "Site", description: "All site files" });

    const del = await json(await collection.DELETE(request(`/api/collections/${c.id}`, { method: "DELETE", cookie }), params({ id: c.id })));
    expect(del.data).toEqual({ releasedAssets: 2 });
    expect(await db.asset.count()).toBe(2);
    expect(await db.asset.count({ where: { collectionId: { not: null } } })).toBe(0);
  });

  it("isolates collections and cover assets between users", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    const c = (await json(await collections.POST(request("/api/collections", { method: "POST", cookie: alice.cookie, body: { name: "Mine" } }), {} as never))).data;
    const bobImg = (await (await uploadFile(bob.cookie, "b.png", await pngBytes())).json()).data;
    expect((await collection.GET(request(`/api/collections/${c.id}`, { cookie: bob.cookie }), params({ id: c.id }))).status).toBe(404);
    expect((await collection.DELETE(request(`/api/collections/${c.id}`, { method: "DELETE", cookie: bob.cookie }), params({ id: c.id }))).status).toBe(404);
    const steal = await collection.PATCH(request(`/api/collections/${c.id}`, { method: "PATCH", cookie: alice.cookie, body: { coverAssetId: bobImg.id } }), params({ id: c.id }));
    expect(steal.status).toBe(404);
    const move = await item.PATCH(request(`/api/assets/${bobImg.id}`, { method: "PATCH", cookie: bob.cookie, body: { collectionId: c.id } }), params({ id: bobImg.id }));
    expect(move.status).toBe(404);
  });
});
