import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { listAssetsQuery } from "@/lib/validation/assets";
import { createAsset, listAssets, updateAsset } from "@/server/assets/service";
import { assetSearchText, cosine, indexAsset, setEmbeddingsForTests, type EmbeddingProvider } from "@/server/embeddings";
import { createUser, resetDatabase } from "../support/db";
import { pngBytes } from "../support/files";

// Deterministic stand-in for an embeddings model: synonyms share a dimension.
const CONCEPTS = [["purple", "violet", "lavender"], ["dashboard", "analytics", "chart", "metrics"], ["cat", "kitten", "feline"], ["beach", "ocean", "sea"]];
const DIMS = 32;
function vec(text: string): number[] {
  const v = new Array(DIMS).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const c = CONCEPTS.findIndex((group) => group.includes(w));
    if (c >= 0) v[c] += 1;
    else v[4 + ([...w].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) % (DIMS - 4))] += 0.3;
  }
  return v;
}
let calls = 0;
const fake: EmbeddingProvider = {
  model: "fake-embed-1",
  async embed(texts) {
    calls += texts.length;
    return texts.map(vec);
  },
};

const search = (ownerId: string, params: Record<string, string>) => listAssets(ownerId, listAssetsQuery.parse(params));
const add = (ownerId: string, name: string, extra: { description?: string; tags?: string[]; kind?: "IMAGE" | "DOCUMENT" } = {}) =>
  pngBytes().then((buffer) => createAsset(ownerId, { name, buffer, mimeType: "image/png", extension: "png", kind: extra.kind ?? "IMAGE", source: "UPLOAD", tags: extra.tags ?? [], description: extra.description }));

beforeEach(async () => {
  await resetDatabase();
  calls = 0;
  setEmbeddingsForTests(async () => fake);
});
afterEach(() => setEmbeddingsForTests(null));

describe("semantic asset search", () => {
  it("finds assets by meaning, not just words", async () => {
    const u = await createUser();
    const hit = await add(u.id, "violet analytics screen.png");
    const cat = await add(u.id, "kitten on sofa.png");
    await add(u.id, "beach sunset.png");
    for (const a of await db.asset.findMany()) expect(await indexAsset(a.id)).toBe("indexed");

    const keywordOnly = await db.asset.count({ where: { name: { contains: "purple", mode: "insensitive" } } });
    expect(keywordOnly).toBe(0);
    const r = await search(u.id, { q: "purple dashboard" });
    expect(r.search).toBe("semantic");
    expect(r.items[0].id).toBe(hit.id);
    expect(r.items.map((i) => i.id)).not.toContain(cat.id); // unrelated results are cut off

    expect((await search(u.id, { q: "feline" })).items[0].id).toBe(cat.id);
  });

  it("keeps exact keyword matches on top and respects filters and ownership", async () => {
    const u = await createUser();
    const other = await createUser("Other");
    const exact = await add(u.id, "Q3 metrics deck", { kind: "DOCUMENT" });
    const near = await add(u.id, "analytics chart.png");
    const theirs = await add(other.id, "dashboard metrics analytics.png");
    for (const a of await db.asset.findMany()) await indexAsset(a.id);

    const r = await search(u.id, { q: "Q3 metrics" });
    expect(r.items[0].id).toBe(exact.id);
    expect(r.items.map((i) => i.id)).not.toContain(theirs.id);
    expect((await search(u.id, { q: "dashboard", kinds: "IMAGE" })).items.map((i) => i.id)).toEqual([near.id]);
  });

  it("re-embeds only when the descriptive text changes", async () => {
    const u = await createUser();
    const a = await add(u.id, "ocean.png");
    expect(await indexAsset(a.id)).toBe("indexed");
    expect(await indexAsset(a.id)).toBe("unchanged");
    await updateAsset(u.id, a.id, { tags: ["beach", "summer"] });
    expect(await indexAsset(a.id)).toBe("indexed");
    expect(calls).toBe(2);
    expect(assetSearchText({ name: "x", description: null, kind: "IMAGE", originalPrompt: "a red fox", tags: ["fox"], workflowName: "Hero" })).toBe("x\ntype: image\ntags: fox\nprompt: a red fox\nworkflow: Hero");
  });

  it("falls back to keyword search without an embeddings provider", async () => {
    const u = await createUser();
    await add(u.id, "violet analytics screen.png");
    setEmbeddingsForTests(async () => null);
    expect(await indexAsset((await db.asset.findFirstOrThrow()).id)).toBe("no-provider");
    const r = await search(u.id, { q: "purple dashboard" });
    expect(r).toMatchObject({ search: "keyword", items: [] });
    expect((await search(u.id, { q: "violet" })).items).toHaveLength(1);
  });

  it("cosine similarity", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});
