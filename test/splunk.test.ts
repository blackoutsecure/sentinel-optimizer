import { describe, it, expect } from "vitest";
import { parseSplunk, type SplunkInput } from "../parsers/splunk.js";
import sample from "../samples/splunk.json" assert { type: "json" };

const input = sample as SplunkInput;

describe("parseSplunk", () => {
  const result = parseSplunk(input);

  it("normalizes the vendor and source count", () => {
    expect(result.vendor).toBe("splunk");
    expect(result.sources).toHaveLength(3);
  });

  it("maps index bytes and derives gbPerDay", () => {
    const main = result.sources.find((s) => s.name === "main");
    expect(main?.bytes).toBe(32_212_254_720);
    // 32,212,254,720 bytes over 30 days ≈ 1.0737 GB/day
    expect(main?.gbPerDay).toBeCloseTo(1.073741824, 6);
  });

  it("includes events only when reported", () => {
    const windows = result.sources.find((s) => s.name === "windows");
    expect(windows?.events).toBeUndefined();
  });

  it("aggregates totals, summing only reported events", () => {
    expect(result.totals?.bytes).toBe(56_371_445_760);
    expect(result.totals?.events).toBe(69_000_000);
  });

  it("is deterministic", () => {
    expect(parseSplunk(input)).toEqual(result);
  });
});
