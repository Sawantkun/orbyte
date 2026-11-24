/**
 * Static URL checks for the HTTP Request node. This runs at validation time on
 * literal URLs. The execution worker (Milestone 3) repeats these checks on
 * every resolved address after DNS lookup and on each redirect — this file is
 * defence in depth, not the SSRF boundary by itself.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

export function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return V4_BLOCKS.some(([base, bits]) => {
    const b = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  });
}

export function isPrivateIPv6(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::" || h === "::1") return true;
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  // Hex-form IPv4-mapped (::ffff:7f00:1) — Node's URL parser normalises to this.
  const hexMapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const n = (parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16);
    return isPrivateIPv4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
  }
  return /^(fc|fd)/.test(h) || /^fe[89ab]/.test(h) || /^ff/.test(h);
}

export type UrlCheck = { ok: true; dynamicHost: boolean } | { ok: false; reason: string };

/** Validate a URL that may contain {{template}} references. */
export function checkRequestUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "URL is required" };
  const schemeHost = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/);
  if (!schemeHost) return { ok: false, reason: "URL must start with https:// or http://" };
  const scheme = schemeHost[1].toLowerCase();
  if (scheme !== "https" && scheme !== "http") return { ok: false, reason: "Only http and https URLs are allowed" };
  const authority = schemeHost[2];
  if (authority.includes("{{")) return { ok: true, dynamicHost: true };
  if (authority.includes("@")) return { ok: false, reason: "Credentials in URLs are not allowed" };

  let url: URL;
  try {
    // Template refs in the path/query are fine; replace them so URL parsing succeeds.
    url = new URL(trimmed.replace(/\{\{[^}]*\}\}/g, "x"));
  } catch {
    return { ok: false, reason: "URL is not valid" };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "URL is missing a host" };
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "Requests to local or internal hosts are blocked" };
  }
  if (isPrivateIPv4(host) || (host.startsWith("[") && isPrivateIPv6(host))) {
    return { ok: false, reason: "Requests to private, loopback or metadata addresses are blocked" };
  }
  // Numeric hosts in non-dotted forms (e.g. http://2130706433) are normalised by URL() to dotted IPv4 above.
  return { ok: true, dynamicHost: false };
}
