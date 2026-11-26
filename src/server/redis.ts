import "server-only";
import { Redis } from "ioredis";
import { env } from "@/lib/env";

let client: Redis | null = null;

/** Shared app-side Redis client (rate limiting). BullMQ manages its own connections. */
export function getRedis(): Redis {
  client ??= new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
    connectTimeout: 2000,
  });
  client.on("error", () => {
    /* surfaced per-call; avoid unhandled error events */
  });
  return client;
}
