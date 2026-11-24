import { describe, expect, it } from "vitest";
import { buildDailySeries } from "@/server/dashboard";
import { formatDayKey, formatDuration, formatUsd } from "@/lib/format";
import { costTick } from "@/components/usage/cost-chart";

describe("cost chart ticks", () => {
  it("keeps adjacent ticks distinct at small scales", () => {
    const ticks = [0.00125, 0.0025, 0.00375, 0.005].map((v) => costTick(v, 0.005));
    expect(new Set(ticks).size).toBe(4);
    expect(ticks[1]).toBe("$0.0025");
    expect(costTick(0, 0.005)).toBe("$0");
    expect(costTick(0.25, 0.5)).toBe("$0.250");
    expect(costTick(5, 8)).toBe("$5.00");
    expect(costTick(120, 400)).toBe("$120");
  });
});

describe("buildDailySeries", () => {
  const now = new Date("2026-11-24T15:00:00Z");

  it("zero-fills every day in the window, oldest first", () => {
    const s = buildDailySeries([], 3, now);
    expect(s.map((d) => d.date)).toEqual(["2026-11-22", "2026-11-23", "2026-11-24"]);
    expect(s.every((d) => d.completed + d.failed + d.other === 0)).toBe(true);
  });

  it("buckets statuses and ignores rows outside the window", () => {
    const s = buildDailySeries(
      [
        { day: "2026-11-24", status: "COMPLETED", count: 3n },
        { day: "2026-11-24", status: "FAILED", count: 1n },
        { day: "2026-11-23", status: "CANCELLED", count: 2n },
        { day: "2026-11-01", status: "COMPLETED", count: 9n },
      ],
      3,
      now,
    );
    expect(s[2]).toEqual({ date: "2026-11-24", completed: 3, failed: 1, other: 0 });
    expect(s[1]).toEqual({ date: "2026-11-23", completed: 0, failed: 0, other: 2 });
  });
});

describe("format helpers", () => {
  it("formats day keys without timezone drift", () => {
    expect(formatDayKey("2026-01-01")).toBe("Jan 1");
  });
  it("formats durations and money", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(2500)).toBe("2.5 s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(formatUsd(0.0123)).toBe("$0.0123");
  });
});
