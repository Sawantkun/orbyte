import "server-only";
import { Queue } from "bullmq";
import { env } from "@/lib/env";

export const EXECUTION_QUEUE = env.EXECUTION_QUEUE_NAME;
export type ExecutionJob = { executionId: string };

export const redisConnection = () => ({ url: env.REDIS_URL, maxRetriesPerRequest: null });

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
