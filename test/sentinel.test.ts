import { describe, it, expect } from "vitest";
import { parseSentinel, type SentinelInput } from "../parsers/sentinel.js";
import sample from "../samples/sentinel.json" assert { type: "json" };

const input = sample as SentinelInput;

describe("parseSentinel", () => {
  const result = parseSentinel(input);

  it("normalizes the vendor and source count", () => {
    expect(result.vendor).toBe("sentinel");
    expect(result.sources).toHaveLength(3);
  });

  it("converts Usage MB quantities to bytes", () => {
    const securityEvent = result.sources.find((s) => s.name === "SecurityEvent");
    expect(securityEvent?.bytes).toBe(1_228_800 * 1_000_000);
  });

  it("derives gbPerDay from the reporting window", () => {
    const securityEvent = result.sources.find((s) => s.name === "SecurityEvent");
    // 1,228,800 MB over 30 days = 40.96 GB/day
    expect(securityEvent?.gbPerDay).toBeCloseTo(40.96, 5);
  });

  it("aggregates totals across sources", () => {
    expect(result.totals?.bytes).toBe(2_457_600 * 1_000_000);
    expect(result.totals?.gbPerDay).toBeCloseTo(81.92, 5);
  });

  it("passes through connectors when provided", () => {
    expect(result.connectors).toHaveLength(2);
    expect(result.connectors?.[0]).toEqual({
      name: "AzureActiveDirectory",
      kind: "AzureActiveDirectory",
      enabled: true,
    });
  });

  it("is deterministic", () => {
    expect(parseSentinel(input)).toEqual(result);
  });
});
