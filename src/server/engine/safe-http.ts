import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { checkRequestUrl, isPrivateIPv4, isPrivateIPv6 } from "@/lib/workflow/url-safety";
import { NodeError } from "./errors";

/**
 * Outbound HTTP for the HTTP Request node. SSRF defences:
 *  1. Static URL check (scheme, credentials, literal private/metadata hosts).
 *  2. DNS answers are validated inside the socket's `lookup`, i.e. against the
 *     exact address we connect to — defeats DNS rebinding.
 *  3. Redirects are followed manually and every hop is re-checked.
 *  4. Timeouts, response-size cap, header filtering.
 */
export type LookupFn = typeof dns.lookup;

export type SafeRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  maxBytes?: number;
  maxRedirects?: number;
  /** Injectable for tests. */
  lookup?: LookupFn;
  /** Address policy; defaults to blocking private/reserved ranges. Tests only. */
  isBlocked?: (address: string) => boolean;
};

export type SafeResponse = { status: number; headers: Record<string, string>; body: string; url: string };

const BLOCKED_REQUEST_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "proxy-authorization", "te", "keep-alive"]);
const DROPPED_RESPONSE_HEADERS = new Set(["set-cookie"]);

export function isBlockedAddress(address: string): boolean {
  return net.isIPv6(address) ? isPrivateIPv6(address) : isPrivateIPv4(address);
}

function guardedLookup(base: LookupFn, isBlocked: (address: string) => boolean): net.LookupFunction {
  return ((hostname: string, options: dns.LookupOptions, callback: (err: Error | null, address: string | dns.LookupAddress[], family?: number) => void) => {
    base(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      const list = (Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }]) as dns.LookupAddress[];
      const blocked = list.find((a) => isBlocked(a.address));
      if (blocked || list.length === 0) {
        return callback(new NodeError("UNSAFE_URL", `Requests to ${hostname} are blocked (resolves to a private or reserved address)`, false), "", 4);
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  }) as net.LookupFunction;
}

function once(req: SafeRequest, url: URL, lookup: net.LookupFunction): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const maxBytes = req.maxBytes ?? 2 * 1024 * 1024;
  const mod = url.protocol === "https:" ? https : http;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!k || BLOCKED_REQUEST_HEADERS.has(k.toLowerCase())) continue;
    headers[k] = v.slice(0, 8192);
  }
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) headers["User-Agent"] = "Orbyte-Workflow/1.0";

  return new Promise((resolve, reject) => {
    // agent:false → no keep-alive pooling. A pooled socket would skip the guarded
    // DNS lookup, so every request must open (and validate) its own connection.
    const r = mod.request(url, { method: req.method, headers, lookup, agent: false, signal: req.signal, timeout: req.timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new NodeError("RESPONSE_TOO_LARGE", `Response exceeded ${Math.round(maxBytes / 1024)} KB`, false));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    r.on("timeout", () => r.destroy(new NodeError("TIMEOUT", `Request timed out after ${req.timeoutMs} ms`, true)));
    r.on("error", (e) => reject(e instanceof NodeError ? e : req.signal?.aborted ? new NodeError("CANCELLED", "Request cancelled", false) : new NodeError("NETWORK", `Request failed: ${(e as NodeJS.ErrnoException).code ?? e.message}`, true)));
    if (req.body !== undefined && req.method !== "GET" && req.method !== "HEAD") r.write(req.body);
    r.end();
  });
}

export async function safeRequest(req: SafeRequest): Promise<SafeResponse> {
  const lookup = guardedLookup(req.lookup ?? dns.lookup, req.isBlocked ?? isBlockedAddress);
  let current = req.url;
  let method = req.method;
  let body = req.body;
  for (let hop = 0; hop <= (req.maxRedirects ?? 3); hop++) {
    const check = checkRequestUrl(current);
    if (!check.ok) throw new NodeError("UNSAFE_URL", check.reason, false);
    const url = new URL(current);
    const res = await once({ ...req, method, body }, url, lookup);
    if ([301, 302, 303, 307, 308].includes(res.status) && typeof res.headers.location === "string") {
      current = new URL(res.headers.location, url).toString();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined || DROPPED_RESPONSE_HEADERS.has(k)) continue;
      headers[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    return { status: res.status, headers, body: res.body, url: current };
  }
  throw new NodeError("TOO_MANY_REDIRECTS", "Too many redirects", false);
}
