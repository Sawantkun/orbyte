import { describe, expect, it } from "vitest";
import { describeIp, describeUserAgent } from "@/server/sessions";

describe("session display helpers", () => {
  it("describes common user agents", () => {
    expect(
      describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36"),
    ).toBe("Chrome on macOS");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; rv:120.0) Gecko/20100101 Firefox/120.0")).toBe("Firefox on Windows");
    expect(describeUserAgent(null)).toBe("Unknown device");
  });
  it("labels loopback addresses", () => {
    expect(describeIp("::1")).toBe("Local network");
    expect(describeIp("203.0.113.9")).toBe("203.0.113.9");
    expect(describeIp(null)).toBe("Unknown IP");
  });
});
