import "server-only";
import { Queue } from "bullmq";
import { env } from "@/lib/env";

export const EXECUTION_QUEUE = env.EXECUTION_QUEUE_NAME;
export type ExecutionJob = { executionId: string };

export const redisConnection = () => ({ url: env.REDIS_URL, maxRetriesPerRequest: null });

export const EMBEDDING_QUEUE = `${env.EXECUTION_QUEUE_NAME}-embeddings`;
export type EmbeddingJob = { assetId: string };

let embeddingQueue: Queue<EmbeddingJob> | null = null;

/**
 * Ask the worker to (re)index an asset for semantic search. Best effort: search
 * falls back to keywords for anything not indexed, so failures are only logged.
 */
export async function enqueueAssetIndex(assetId: string): Promise<void> {
  if (env.SEMANTIC_SEARCH === "off") return;
  try {
    embeddingQueue ??= new Queue<EmbeddingJob>(EMBEDDING_QUEUE, { connection: redisConnection() });
    // Same id while waiting collapses repeated edits into one job.
    await embeddingQueue.add("index", { assetId }, { jobId: `asset-${assetId}`, attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: true, removeOnFail: { age: 24 * 3600 } });
  } catch (e) {
    console.warn("[search] couldn't queue asset indexing", (e as Error).message);
  }
}

let queue: Queue<ExecutionJob> | null = null;

export function getExecutionQueue(): Queue<ExecutionJob> {
  queue ??= new Queue<ExecutionJob>(EXECUTION_QUEUE, { connection: redisConnection() });
  return queue;
}

/**
 * Enqueue with jobId = executionId so duplicate submissions collapse into one
 * job. Node-level retries happen inside the engine, so the job itself is not
 * retried; BullMQ's stalled-job recovery re-delivers it if a worker dies.
 */
export async function enqueueExecution(executionId: string): Promise<void> {
  await getExecutionQueue().add("run", { executionId }, {
    jobId: executionId,
    attempts: 1,
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  });
}
