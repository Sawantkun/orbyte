/**
 * Orbyte execution worker. Run with `pnpm worker` (dev) or `pnpm worker:start`.
 * Consumes the BullMQ queue and executes workflows via the engine. Runs as a
 * separate process from the web app so it can be scaled independently.
 */
import http from "node:http";
import { Worker } from "bullmq";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { runExecution } from "@/server/engine/executor";
import { defaultProviders } from "@/server/providers";
import { EXECUTION_QUEUE, redisConnection, type ExecutionJob } from "@/server/queue";

const worker = new Worker<ExecutionJob>(
  EXECUTION_QUEUE,
  async (job) => {
    const status = await runExecution(job.data.executionId, {
      providers: defaultProviders,
      nodeConcurrency: env.EXECUTION_NODE_CONCURRENCY,
      nodeTimeoutMs: env.EXECUTION_NODE_TIMEOUT_MS,
      maxAttempts: env.EXECUTION_MAX_ATTEMPTS,
    });
    return { status };
  },
  {
    connection: redisConnection(),
    concurrency: env.WORKER_CONCURRENCY,
    // A job is "stalled" if the worker stops renewing its lock; BullMQ then re-delivers it once,
    // and the engine resumes from persisted node state.
    lockDuration: 60_000,
    maxStalledCount: 1,
  },
);

worker.once("ready", () => console.log(`[worker] ready — queue=${EXECUTION_QUEUE} concurrency=${env.WORKER_CONCURRENCY}`));
worker.on("completed", (job, result) => console.log(`[worker] ${job.data.executionId} → ${(result as { status: string }).status}`));
worker.on("failed", (job, err) => console.error(`[worker] ${job?.data.executionId} crashed: ${err.name}`));
worker.on("error", (err) => console.error(`[worker] error: ${err.name} ${err.message}`));

let stopping = false;

if (env.WORKER_HEALTH_PORT) {
  http
    .createServer((req, res) => {
      const ok = req.url === "/health" && worker.isRunning() && !stopping;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ status: ok ? "ok" : "unavailable" }));
    })
    .listen(env.WORKER_HEALTH_PORT, "127.0.0.1");
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} received, finishing in-flight jobs…`);
  await worker.close(); // waits for active jobs
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
