import { describe, it, expect } from "vitest";
import {
  bytesToGbPerDay,
  computeTotals,
  type NormalizedSource,
} from "../schema/normalization.js";

describe("bytesToGbPerDay", () => {
  it("converts bytes over a window to GB/day", () => {
    expect(bytesToGbPerDay(30_000_000_000, 30)).toBeCloseTo(1, 6);
  });

  it("returns 0 for a non-positive window", () => {
    expect(bytesToGbPerDay(1_000_000_000, 0)).toBe(0);
    expect(bytesToGbPerDay(1_000_000_000, -5)).toBe(0);
  });
});

describe("computeTotals", () => {
  it("sums each metric independently", () => {
    const sources: NormalizedSource[] = [
      { name: "a", bytes: 100, events: 10, gbPerDay: 1 },
      { name: "b", bytes: 200, events: 20, gbPerDay: 2 },
    ];
    expect(computeTotals(sources)).toEqual({ bytes: 300, events: 30, gbPerDay: 3 });
  });

  it("only includes a metric when at least one source reports it", () => {
    const sources: NormalizedSource[] = [
      { name: "a", bytes: 100 },
      { name: "b", bytes: 200 },
    ];
    expect(computeTotals(sources)).toEqual({ bytes: 300 });
  });

  it("returns an empty object for no metrics", () => {
    expect(computeTotals([{ name: "a" }])).toEqual({});
  });
});
