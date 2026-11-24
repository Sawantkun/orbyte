import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("safeRedirectPath", () => {
  it("allows same-origin app paths", () => {
    expect(safeRedirectPath("/settings/security")).toBe("/settings/security");
    expect(safeRedirectPath("/assets?tag=x")).toBe("/assets?tag=x");
  });

  it.each([
    ["https://evil.example"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["javascript:alert(1)"],
    ["dashboard"],
    ["/login"],
    ["/signup?x"],
    ["/api/auth/sign-out"],
  ])("rejects %s", (value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });

  it("falls back for non-strings", () => {
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath(["/a", "/b"])).toBe("/dashboard");
  });
});
