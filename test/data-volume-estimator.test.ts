import { describe, it, expect } from "vitest";
import {
  estimateDataVolume,
  rowGbPerDay,
  DATA_SOURCE_CATALOG,
  type DataVolumeInput,
} from "../estimators/dataVolumeEstimator.js";
import sample from "../samples/data-volume-estimator.json" assert { type: "json" };

const SECONDS_PER_DAY = 24 * 60 * 60;
const BYTES_PER_GIB = 1024 ** 3;

describe("rowGbPerDay", () => {
  it("matches the GiB-based volume formula", () => {
    // 200 Windows medium servers: 700 bytes × 3 EPS × 200 nodes.
    const expected = (700 * (3 * 200) * SECONDS_PER_DAY) / BYTES_PER_GIB;
    expect(rowGbPerDay(700, 3, 200)).toBeCloseTo(expected, 10);
  });

  it("returns 0 for zero nodes", () => {
    expect(rowGbPerDay(1000, 15, 0)).toBe(0);
  });
});

describe("estimateDataVolume", () => {
  const result = estimateDataVolume(sample as DataVolumeInput);

  it("normalizes to the sentinel vendor with one source per input row", () => {
    expect(result.vendor).toBe("sentinel");
    expect(result.sources).toHaveLength(6);
  });

  it("computes gbPerDay per source from the catalog defaults", () => {
    const fw = result.sources.find((s) => s.name === "Network Firewalls (DMZ)");
    // 250 bytes × 50 EPS × 4 nodes.
    const expected = (250 * (50 * 4) * SECONDS_PER_DAY) / BYTES_PER_GIB;
    expect(fw?.gbPerDay).toBeCloseTo(expected, 10);
  });

  it("aggregates a gbPerDay total across all sources", () => {
    const sum = result.sources.reduce((a, s) => a + (s.gbPerDay ?? 0), 0);
    expect(result.totals?.gbPerDay).toBeCloseTo(sum, 10);
    expect(result.totals?.gbPerDay).toBeGreaterThan(0);
  });

  it("honors per-row overrides", () => {
    const out = estimateDataVolume({
      rows: [{ name: "Custom", count: 10, avgEventSizeBytes: 500, avgEpsPerNode: 2 }],
    });
    const expected = (500 * (2 * 10) * SECONDS_PER_DAY) / BYTES_PER_GIB;
    expect(out.sources[0]?.gbPerDay).toBeCloseTo(expected, 10);
  });

  it("ignores unknown sources without overrides", () => {
    const out = estimateDataVolume({ rows: [{ name: "Not In Catalog", count: 100 }] });
    expect(out.sources).toHaveLength(0);
    expect(out.totals?.gbPerDay).toBe(0);
  });

  it("is deterministic", () => {
    expect(estimateDataVolume(sample as DataVolumeInput)).toEqual(result);
  });

  it("exposes a non-empty catalog", () => {
    expect(DATA_SOURCE_CATALOG.length).toBeGreaterThan(0);
    for (const profile of DATA_SOURCE_CATALOG) {
      expect(profile.avgEventSizeBytes).toBeGreaterThan(0);
      expect(profile.avgEpsPerNode).toBeGreaterThan(0);
    }
  });
});
