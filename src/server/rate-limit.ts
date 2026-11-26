import "server-only";
import type { Redis } from "ioredis";
import { getRedis } from "./redis";

export type RateRule = { window: number; max: number };
export type RateResult = { allowed: boolean; retryAfter: number | null };

/**
 * Fixed-window limiter. Increment, first-hit expiry and the verdict happen in
 * one Lua script, so concurrent requests cannot slip past a stale read.
 * Returns {count, ttl_ms}.
 */
const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}
`;

/** Per-process fallback used only while Redis is unreachable (degraded, but still limiting). */
const memory = new Map<string, { count: number; resetAt: number }>();
function consumeMemory(key: string, rule: RateRule, now = Date.now()): RateResult {
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + rule.window * 1000 });
    if (memory.size > 50_000) for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    return { allowed: true, retryAfter: null };
  }
  entry.count++;
  return entry.count <= rule.max ? { allowed: true, retryAfter: null } : { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
}

let warned = false;

export async function consume(key: string, rule: RateRule, redis: Pick<Redis, "eval"> = getRedis()): Promise<RateResult> {
  try {
    const [count, ttl] = (await redis.eval(SCRIPT, 1, `rl:${key}`, String(rule.window * 1000))) as [number, number];
    warned = false;
    return count <= rule.max ? { allowed: true, retryAfter: null } : { allowed: false, retryAfter: Math.max(1, Math.ceil(ttl / 1000)) };
  } catch {
    if (!warned) {
      console.error("[rate-limit] Redis unavailable; using in-process fallback limits");
      warned = true;
    }
    return consumeMemory(key, rule);
  }
}

/** API limits per authenticated user. */
export const API_LIMITS = {
  read: { window: 60, max: 600 },
  write: { window: 60, max: 120 },
  upload: { window: 60, max: 60 },
  execute: { window: 60, max: 30 },
  credentials: { window: 60, max: 10 },
} as const satisfies Record<string, RateRule>;

export type ApiLimit = keyof typeof API_LIMITS;
