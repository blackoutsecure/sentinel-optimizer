import { describe, it, expect } from "vitest";
import { parseGeneric } from "../parsers/generic.js";

describe("parseGeneric", () => {
  it("detects name + bytes and derives gbPerDay over the window", () => {
    const result = parseGeneric(
      {
        windowDays: 30,
        sources: [
          { name: "AWS CloudTrail", bytes: 32_212_254_720 },
          { name: "Firewall", bytes: 16_106_127_360 },
        ],
      },
      { vendor: "rapid7" },
    );

    expect(result.vendor).toBe("rapid7");
    expect(result.sources).toHaveLength(2);
    const ct = result.sources.find((s) => s.name === "AWS CloudTrail");
    expect(ct?.bytes).toBe(32_212_254_720);
    expect(ct?.gbPerDay).toBeCloseTo(1.073741824, 6);
    expect(result.totals?.bytes).toBe(48_318_382_080);
  });

  it("accepts a bare array of rows", () => {
    const result = parseGeneric(
      [
        { source: "a", bytes: 1_000_000_000 },
        { source: "b", bytes: 2_000_000_000 },
      ],
      { vendor: "datadog", defaultWindowDays: 10 },
    );
    expect(result.sources).toHaveLength(2);
    // 1 GB over 10 days = 0.1 GB/day
    expect(result.sources[0]?.gbPerDay).toBeCloseTo(0.1, 6);
  });

  it("converts GB and MB columns to bytes", () => {
    const result = parseGeneric(
      { windowDays: 30, rows: [{ source: "x", gb: 300 }, { source: "y", mb: 1500 }] },
      { vendor: "datadog" },
    );
    expect(result.sources[0]?.bytes).toBe(300_000_000_000);
    expect(result.sources[1]?.bytes).toBe(1_500_000_000);
  });

  it("estimates volume from events when avgEventBytes is supplied (EPS platforms)", () => {
    const result = parseGeneric(
      { windowDays: 30, results: [{ name: "Cisco ASA", events: 240_000_000 }] },
      { vendor: "qradar", avgEventBytes: 512 },
    );
    const asa = result.sources[0];
    expect(asa?.events).toBe(240_000_000);
    expect(asa?.bytes).toBe(122_880_000_000);
    expect(asa?.gbPerDay).toBeCloseTo(4.096, 6);
  });

  it("does not invent volume from events without avgEventBytes", () => {
    const result = parseGeneric(
      { windowDays: 30, results: [{ name: "Cisco ASA", events: 240_000_000 }] },
      { vendor: "qradar" },
    );
    expect(result.sources[0]?.bytes).toBeUndefined();
    expect(result.sources[0]?.gbPerDay).toBeUndefined();
    expect(result.totals?.bytes).toBeUndefined();
  });

  it("honors a per-row gbPerDay and back-fills bytes", () => {
    const result = parseGeneric(
      { windowDays: 30, sources: [{ name: "x", gbPerDay: 5 }] },
      { vendor: "logscale" },
    );
    expect(result.sources[0]?.gbPerDay).toBe(5);
    expect(result.sources[0]?.bytes).toBe(150_000_000_000);
  });

  it("recognizes platform-specific column aliases (_sourceCategory, #repo, store.size)", () => {
    const sumo = parseGeneric(
      { results: [{ _sourceCategory: "prod/os/linux", bytes: 6_442_450_944 }] },
      { vendor: "sumologic" },
    );
    expect(sumo.sources[0]?.name).toBe("prod/os/linux");

    const logscale = parseGeneric({ rows: [{ "#repo": "edr", bytes: 1 }] }, { vendor: "logscale" });
    expect(logscale.sources[0]?.name).toBe("edr");

    const elastic = parseGeneric(
      { indices: [{ index: "logs", "store.size": "21474836480" }] },
      { vendor: "elastic" },
    );
    expect(elastic.sources[0]?.bytes).toBe(21_474_836_480);
  });

  it("coerces comma-formatted numeric strings", () => {
    const result = parseGeneric(
      { windowDays: 30, sources: [{ name: "x", bytes: "1,000,000,000" }] },
      { vendor: "chronicle" },
    );
    expect(result.sources[0]?.bytes).toBe(1_000_000_000);
  });

  it("falls back to a positional name when no name column is present", () => {
    const result = parseGeneric({ rows: [{ bytes: 1 }] }, { vendor: "datadog" });
    expect(result.sources[0]?.name).toBe("source-1");
  });
});
