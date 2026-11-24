/**
 * Scrub secrets from anything we persist or log. Applied to node inputs,
 * outputs, logs and errors before they are written.
 */
const SECRET_KEYS = /^(authorization|proxy-authorization|x-api-key|api[-_]?key|apikey|password|passwd|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|cookie|set-cookie)$/i;

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style keys
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, // Anthropic
  /\bAIza[0-9A-Za-z_-]{30,}\b/g, // Google
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g, // GitHub
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g, // Slack
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

export const REDACTED = "[redacted]";

export function redactString(s: string, extraSecrets: string[] = []): string {
  let out = s;
  for (const secret of extraSecrets) if (secret && secret.length >= 6) out = out.split(secret).join(REDACTED);
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

export function redact<T>(value: T, extraSecrets: string[] = [], depth = 0): T {
  if (depth > 20) return value;
  if (typeof value === "string") return redactString(value, extraSecrets) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, extraSecrets, depth + 1)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.test(k) && v != null && v !== "" ? REDACTED : redact(v, extraSecrets, depth + 1);
    }
    // {key, value} pairs, e.g. HTTP node headers.
    if (typeof out.key === "string" && SECRET_KEYS.test(out.key) && "value" in out) out.value = REDACTED;
    return out as T;
  }
  return value;
}
