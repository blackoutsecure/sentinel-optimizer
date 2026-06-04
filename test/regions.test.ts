import { describe, it, expect } from "vitest";
import {
  estimateMonthlyCost,
  DEFAULT_SENTINEL_RATES,
} from "../pricing/sentinelPricing.js";
import {
  SENTINEL_REGIONS,
  DEFAULT_REGION_ID,
  regionById,
  ratesForRegion,
  cheapestRegion,
} from "../pricing/regions.js";

const DAYS = 365 / 12;

describe("region registry", () => {
  it("anchors the US base price at $0.15/GB", () => {
    const base = regionById(DEFAULT_REGION_ID);
    expect(base?.analyticsIngestPerGb).toBe(0.15);
    expect(DEFAULT_SENTINEL_RATES.analyticsIngestPerGb).toBe(0.15);
  });

  it("has unique region ids", () => {
    const ids = SENTINEL_REGIONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks regions up case-insensitively", () => {
    expect(regionById("WestEurope")?.id).toBe("westeurope");
    expect(regionById("nope")).toBeUndefined();
    expect(regionById(undefined)).toBeUndefined();
  });

  it("finds the cheapest region", () => {
    const cheapest = cheapestRegion();
    expect(cheapest.analyticsIngestPerGb).toBe(0.15);
    for (const r of SENTINEL_REGIONS) {
      expect(r.analyticsIngestPerGb).toBeGreaterThanOrEqual(cheapest.analyticsIngestPerGb);
    }
  });
});

describe("ratesForRegion", () => {
  it("returns base rates for unknown / undefined regions", () => {
    expect(ratesForRegion(undefined)).toEqual(DEFAULT_SENTINEL_RATES);
    expect(ratesForRegion("nope")).toEqual(DEFAULT_SENTINEL_RATES);
  });

  it("scales volume rates by the regional price index", () => {
    const rates = ratesForRegion("brazilsouth"); // 0.21 / 0.15 = 1.4x
    expect(rates.analyticsIngestPerGb).toBeCloseTo(0.21, 4);
    expect(rates.interactiveRetentionPerGbMonth).toBeCloseTo(0.12 * 1.4, 4);
    // Global (non-regional) rates are unchanged.
    expect(rates.securityCopilotPerScuMonth).toBe(DEFAULT_SENTINEL_RATES.securityCopilotPerScuMonth);
    expect(rates.soarFreeActions).toBe(DEFAULT_SENTINEL_RATES.soarFreeActions);
  });
});

describe("region-aware estimateMonthlyCost", () => {
  it("applies the region price to Analytics ingestion", () => {
    const us = estimateMonthlyCost({ analyticsGbPerDay: 100, regionId: "eastus" });
    const br = estimateMonthlyCost({ analyticsGbPerDay: 100, regionId: "brazilsouth" });
    expect(br.breakdown.analyticsIngestion).toBeCloseTo(us.breakdown.analyticsIngestion * 1.4, 1);
    expect(br.regionId).toBe("brazilsouth");
    expect(br.rates.analyticsIngestPerGb).toBeCloseTo(0.21, 4);
  });

  it("input.rates still override region rates", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 100,
      regionId: "brazilsouth",
      rates: { analyticsIngestPerGb: 0.1 },
    });
    expect(out.rates.analyticsIngestPerGb).toBe(0.1);
  });
});

describe("per-table retention", () => {
  it("keeps the 90-day (3-month) free interactive window per table", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 100,
      tableRetention: [{ name: "SecurityEvent", gbPerDay: 100, interactiveMonths: 3 }],
    });
    expect(out.breakdown.interactiveRetention).toBe(0);
    expect(out.breakdown.dataStorage).toBe(0);
  });

  it("charges interactive retention beyond 90 days per table", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 100,
      tableRetention: [{ name: "SecurityEvent", gbPerDay: 100, interactiveMonths: 6 }],
    });
    const expected = Math.round(100 * DAYS * 3 * 0.12 * 100) / 100;
    expect(out.breakdown.interactiveRetention).toBeCloseTo(expected, 2);
  });

  it("charges archive months beyond the interactive window at the storage rate", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 100,
      tableRetention: [
        {
          name: "SecurityEvent",
          gbPerDay: 100,
          lane: "analytics",
          interactiveMonths: 3,
          totalMonths: 24,
        },
      ],
    });
    const expectedArchive = Math.round(100 * DAYS * 21 * 0.0043 * 100) / 100;
    expect(out.breakdown.dataStorage).toBeCloseTo(expectedArchive, 2);
    expect(out.breakdown.interactiveRetention).toBe(0);
  });

  it("sums retention across multiple tables independently", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 150,
      tableRetention: [
        { name: "hot", gbPerDay: 100, lane: "analytics", interactiveMonths: 6 },
        { name: "cold", gbPerDay: 50, lane: "dataLake", interactiveMonths: 3, totalMonths: 12 },
      ],
    });
    const hot = 100 * DAYS * 3 * 0.12;
    const cold = (50 * DAYS * 9 * 0.0043) / DEFAULT_SENTINEL_RATES.dataLakeStorageCompressionRatio;
    expect(out.breakdown.interactiveRetention).toBeCloseTo(Math.round(hot * 100) / 100, 1);
    expect(out.breakdown.dataStorage).toBeCloseTo(Math.round(cold * 100) / 100, 1);
  });

  it("applies data lake compression ratio to archived storage", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 50,
      tableRetention: [
        { name: "lake", gbPerDay: 50, lane: "dataLake", interactiveMonths: 3, totalMonths: 12 },
      ],
    });
    const compressedArchive =
      (50 * DAYS * 9 * 0.0043) / DEFAULT_SENTINEL_RATES.dataLakeStorageCompressionRatio;
    expect(out.breakdown.dataStorage).toBeCloseTo(Math.round(compressedArchive * 100) / 100, 2);
  });

  it("falls back to aggregate retention when no tables are given", () => {
    const out = estimateMonthlyCost({ analyticsGbPerDay: 100, interactiveRetentionMonths: 6 });
    const expected = Math.round(100 * DAYS * 3 * 0.12 * 100) / 100;
    expect(out.breakdown.interactiveRetention).toBeCloseTo(expected, 2);
  });
});
