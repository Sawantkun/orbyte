import "server-only";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { resolveUserSecret } from "./integrations";

/**
 * Semantic search over the asset library (ADR-0003). Each asset's descriptive
 * text (name, description, tags, prompt, kind, workflow) is embedded once and
 * stored; a search embeds the query and ranks the owner's assets by cosine
 * similarity, after the usual structured filters. Uses the owner's OpenAI key,
 * else the workspace key; without either, search stays keyword-only.
 */
export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

class OpenAIEmbeddings implements EmbeddingProvider {
  constructor(
    private readonly apiKey: string,
    readonly model = env.OPENAI_EMBEDDING_MODEL,
  ) {}
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const res = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, "")}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: signal ?? AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Embeddings request failed (HTTP ${res.status})`);
    const json = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const out = new Array<number[]>(texts.length);
    for (const d of json.data ?? []) out[d.index] = d.embedding;
    if (out.some((v) => !Array.isArray(v))) throw new Error("Embeddings response was incomplete");
    return out;
  }
}

let override: ((ownerId: string) => Promise<EmbeddingProvider | null>) | null = null;
/** Tests substitute a deterministic provider. */
export function setEmbeddingsForTests(fn: typeof override) {
  override = fn;
}

export async function embeddingsFor(ownerId: string): Promise<EmbeddingProvider | null> {
  if (override) return override(ownerId);
  if (env.SEMANTIC_SEARCH === "off") return null;
  const own = await resolveUserSecret(ownerId, "openai");
  if (own && "secret" in own) return new OpenAIEmbeddings(own.secret);
  if (env.OPENAI_API_KEY) return new OpenAIEmbeddings(env.OPENAI_API_KEY);
  return null;
}

const MAX_TEXT = 4000;

/** The text that represents an asset for search. */
export function assetSearchText(a: { name: string; description: string | null; kind: string; originalPrompt: string | null; tags: string[]; workflowName: string | null }) {
  return [
    a.name,
    a.description,
    `type: ${a.kind.toLowerCase()}`,
    a.tags.length ? `tags: ${a.tags.join(", ")}` : null,
    a.originalPrompt ? `prompt: ${a.originalPrompt}` : null,
    a.workflowName ? `workflow: ${a.workflowName}` : null,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT);
}

/** Embed (or refresh) one asset. Returns what happened, for logs and tests. */
export async function indexAsset(assetId: string): Promise<"indexed" | "unchanged" | "no-provider" | "missing"> {
  const a = await db.asset.findUnique({
    where: { id: assetId },
    include: { tags: { include: { tag: { select: { name: true } } } }, workflow: { select: { name: true } }, embedding: { select: { contentHash: true, model: true } } },
  });
  if (!a) return "missing";
  const provider = await embeddingsFor(a.ownerId);
  if (!provider) return "no-provider";
  const text = assetSearchText({ ...a, tags: a.tags.map((t) => t.tag.name), workflowName: a.workflow?.name ?? null });
  const contentHash = crypto.createHash("sha256").update(text).digest("hex");
  if (a.embedding?.contentHash === contentHash && a.embedding.model === provider.model) return "unchanged";
  const [vector] = await provider.embed([text]);
  await db.assetEmbedding.upsert({
    where: { assetId },
    create: { assetId, ownerId: a.ownerId, model: provider.model, vector, contentHash },
    update: { model: provider.model, vector, contentHash },
  });
  return "indexed";
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const CANDIDATE_LIMIT = 5000;
export const SEMANTIC_MIN_SCORE = 0.25;

/**
 * Asset ids matching `query` by meaning, best first, among assets passing
 * `where`. Keyword matches get a boost so exact names still rank on top.
 * Returns null when semantic search isn't available (no provider / no index).
 */
export async function semanticAssetIds(
  ownerId: string,
  query: string,
  where: object,
  keywordIds: Set<string>,
  limit: number,
): Promise<string[] | null> {
  const provider = await embeddingsFor(ownerId);
  if (!provider) return null;
  const rows = await db.assetEmbedding.findMany({
    where: { ownerId, model: provider.model, asset: where },
    select: { assetId: true, vector: true },
    take: CANDIDATE_LIMIT,
  });
  if (!rows.length) return null;
  let q: number[];
  try {
    [q] = await provider.embed([query.slice(0, 500)]);
  } catch (e) {
    console.warn("[search] query embedding failed; using keyword search", (e as Error).message);
    return null;
  }
  return rows
    .map((r) => ({ id: r.assetId, score: cosine(q, r.vector) + (keywordIds.has(r.assetId) ? 0.15 : 0) }))
    .filter((r) => r.score >= SEMANTIC_MIN_SCORE || keywordIds.has(r.id))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((r) => r.id);
}
