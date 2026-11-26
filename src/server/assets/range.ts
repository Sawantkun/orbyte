/**
 * Parse a single HTTP Range header (RFC 9110 §14) against a known size.
 * Returns null to ignore the header (absent, malformed, multi-range) and serve
 * the whole file, or "unsatisfiable" for a 416.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (size === 0) return "unsatisfiable";
  let start: number;
  let end: number;
  if (m[1] === "") {
    // Suffix range: last N bytes.
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start > end && m[2] !== "") return null; // invalid → ignore per RFC
    if (start >= size) return "unsatisfiable";
  }
  return { start, end };
}
