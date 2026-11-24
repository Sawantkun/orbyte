import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isBlockedAddress, safeRequest, type LookupFn } from "@/server/engine/safe-http";

let server: http.Server;
let port = 0;
const seen: { url?: string; headers: http.IncomingHttpHeaders }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url === "/json") return res.end(JSON.stringify({ ok: true }));
    if (req.url === "/redirect-safe") return res.writeHead(302, { location: "/json" }).end();
    if (req.url === "/redirect-metadata") return res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }).end();
    if (req.url === "/redirect-internal") return res.writeHead(302, { location: `http://internal.test:${port}/json` }).end();
    if (req.url === "/big") return res.end("x".repeat(5000));
    if (req.url === "/slow") return void setTimeout(() => res.end("late"), 2000);
    if (req.url === "/cookie") return res.writeHead(200, { "set-cookie": "s=1", "x-ok": "1" }).end("c");
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// "public.test" stands in for a public host (resolves to our loopback server, which the
// test policy allows); "internal.test" resolves to a private address and must be refused.
const lookup = ((hostname: string, _opts: unknown, cb: (e: Error | null, a: { address: string; family: number }[]) => void) => {
  if (hostname === "public.test") return cb(null, [{ address: "127.0.0.1", family: 4 }]);
  if (hostname === "internal.test") return cb(null, [{ address: "10.0.0.5", family: 4 }]);
  if (hostname === "mixed.test") return cb(null, [{ address: "8.8.8.8", family: 4 }, { address: "192.168.1.2", family: 4 }]);
  cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), []);
}) as unknown as LookupFn;
const allowLoopbackOnly = (a: string) => a !== "127.0.0.1" && isBlockedAddress(a);
const req = (path: string, extra: Partial<Parameters<typeof safeRequest>[0]> = {}) =>
  safeRequest({ method: "GET", url: `http://public.test:${port}${path}`, headers: {}, timeoutMs: 1000, lookup, isBlocked: allowLoopbackOnly, ...extra });

describe("safeRequest", () => {
  it("fetches from an allowed host", async () => {
    const res = await req("/json");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it("blocks hosts whose DNS answer is private (checked at connect time)", async () => {
    await expect(req("/json", { url: `http://internal.test:${port}/json` })).rejects.toMatchObject({ code: "UNSAFE_URL" });
    await expect(req("/json", { url: `http://mixed.test:${port}/json` })).rejects.toMatchObject({ code: "UNSAFE_URL" });
  });

  it("blocks loopback with the production policy", async () => {
    await expect(safeRequest({ method: "GET", url: `http://public.test:${port}/json`, headers: {}, timeoutMs: 1000, lookup })).rejects.toMatchObject({ code: "UNSAFE_URL" });
  });

  it("follows safe redirects and re-checks every hop", async () => {
    expect((await req("/redirect-safe")).body).toContain("ok");
    await expect(req("/redirect-metadata")).rejects.toMatchObject({ code: "UNSAFE_URL" });
    await expect(req("/redirect-internal")).rejects.toMatchObject({ code: "UNSAFE_URL" });
  });

  it("enforces size limits and timeouts", async () => {
    await expect(req("/big", { maxBytes: 1000 })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    await expect(req("/slow", { timeoutMs: 200 })).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("strips hop-by-hop request headers and drops set-cookie from responses", async () => {
    const res = await req("/cookie", { headers: { Host: "evil.example", "X-Custom": "1" } });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.headers["x-ok"]).toBe("1");
    const last = seen.at(-1)!;
    expect(last.headers.host).toBe(`public.test:${port}`);
    expect(last.headers["x-custom"]).toBe("1");
  });
});
