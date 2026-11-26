import { describe, expect, it } from "vitest";
import { parseRange } from "@/server/assets/range";

describe("parseRange", () => {
  it.each([
    ["bytes=0-99", 1000, { start: 0, end: 99 }],
    ["bytes=500-", 1000, { start: 500, end: 999 }],
    ["bytes=-100", 1000, { start: 900, end: 999 }],
    ["bytes=-5000", 1000, { start: 0, end: 999 }],
    ["bytes=900-5000", 1000, { start: 900, end: 999 }],
  ] as const)("%s of %i", (h, size, expected) => {
    expect(parseRange(h, size)).toEqual(expected);
  });

  it("ignores absent, malformed and multi-range headers", () => {
    for (const h of [null, "", "items=0-1", "bytes=a-b", "bytes=-", "bytes=0-1,5-9", "bytes=9-5"]) expect(parseRange(h, 1000)).toBeNull();
  });

  it("reports unsatisfiable ranges", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1", 0)).toBe("unsatisfiable");
  });
});
