import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import * as validate from "@/app/api/integrations/[id]/validate/route";
import { API_LIMITS, consume } from "@/server/rate-limit";
import { params, request, signedInUser } from "../support/api";
import { resetDatabase } from "../support/db";

describe("Redis rate limiter", () => {
  it("is atomic under concurrency: exactly `max` requests pass", async () => {
    const key = `test:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => consume(key, { window: 30, max: 5 })));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    const denied = results.find((r) => !r.allowed)!;
    expect(denied.retryAfter).toBeGreaterThan(0);
    expect(denied.retryAfter).toBeLessThanOrEqual(30);
  });

  it("resets after the window", async () => {
    const key = `test:${randomUUID()}`;
    expect((await consume(key, { window: 1, max: 1 })).allowed).toBe(true);
    expect((await consume(key, { window: 1, max: 1 })).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await consume(key, { window: 1, max: 1 })).allowed).toBe(true);
  });

  it("keeps limiting in-process when Redis is unavailable", async () => {
    const broken = { eval: async () => Promise.reject(new Error("ECONNREFUSED")) };
    const key = `test:${randomUUID()}`;
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await consume(key, { window: 60, max: 3 }, broken as never));
    expect(r.map((x) => x.allowed)).toEqual([true, true, true, false]);
  });
});

describe("API rate limiting", () => {
  beforeEach(resetDatabase);

  it("returns 429 with Retry-After once a user's bucket is exhausted, without affecting other users", async () => {
    const alice = await signedInUser("Alice");
    const bob = await signedInUser("Bob");
    for (let i = 0; i < API_LIMITS.credentials.max; i++) await consume(`api:credentials:${alice.id}`, API_LIMITS.credentials);
    const res = await validate.POST(request("/api/integrations/x/validate", { method: "POST", cookie: alice.cookie }), params({ id: "x" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    // Bob is unaffected (404: his request reaches the handler).
    expect((await validate.POST(request("/api/integrations/x/validate", { method: "POST", cookie: bob.cookie }), params({ id: "x" }))).status).toBe(404);
  });
});

describe("CSRF origin check", () => {
  beforeEach(resetDatabase);

  it("rejects mutating requests from a foreign origin and allows same-origin ones", async () => {
    const { cookie } = await signedInUser();
    const foreign = request("/api/integrations/x/validate", { method: "POST", cookie });
    foreign.headers.set("origin", "https://evil.example");
    const res = await validate.POST(foreign, params({ id: "x" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ORIGIN");

    const same = request("/api/integrations/x/validate", { method: "POST", cookie });
    same.headers.set("origin", "http://localhost:3000");
    expect((await validate.POST(same, params({ id: "x" }))).status).toBe(404);
  });
});
