import { describe, it, expect } from "vitest";
import {
  estimateMonthlyCost,
  estimateMonthlyCostFromResult,
  DEFAULT_SENTINEL_RATES,
  type SentinelCostInput,
} from "../pricing/sentinelPricing.js";
import type { NormalizedResult } from "../schema/normalization.js";
import sample from "../samples/sentinel-cost.json" assert { type: "json" };

const DAYS = 365 / 12;

describe("DEFAULT_SENTINEL_RATES", () => {
  it("matches the public per-GB list prices", () => {
    expect(DEFAULT_SENTINEL_RATES.analyticsIngestPerGb).toBe(0.15);
    expect(DEFAULT_SENTINEL_RATES.interactiveRetentionPerGbMonth).toBe(0.12);
    expect(DEFAULT_SENTINEL_RATES.dataStoragePerGbMonth).toBe(0.0043);
    expect(DEFAULT_SENTINEL_RATES.dataSearchPerTb).toBe(6);
    expect(DEFAULT_SENTINEL_RATES.freeInteractiveRetentionMonths).toBe(3);
  });
});

describe("estimateMonthlyCost", () => {
  it("applies free-ingestion benefits to billable Analytics volume", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 500,
      benefits: { m365E5FreeGbPerDay: 50, defenderP2FreeGbPerDay: 30 },
    });
    expect(out.benefitGbPerDay).toBe(80);
    expect(out.billableAnalyticsGbPerDay).toBe(420);
    const expected = Math.round(420 * DAYS * 0.15 * 100) / 100;
    expect(out.breakdown.analyticsIngestion).toBeCloseTo(expected, 2);
  });

  it("never bills negative volume when benefits exceed ingestion", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 10,
      benefits: { m365E5FreeGbPerDay: 50 },
    });
    expect(out.billableAnalyticsGbPerDay).toBe(0);
    expect(out.breakdown.analyticsIngestion).toBe(0);
  });

  it("includes the free interactive retention window at no cost", () => {
    const out = estimateMonthlyCost({ analyticsGbPerDay: 500, interactiveRetentionMonths: 3 });
    expect(out.breakdown.interactiveRetention).toBe(0);
  });

  it("charges interactive retention beyond the free window", () => {
    const out = estimateMonthlyCost({ analyticsGbPerDay: 500, interactiveRetentionMonths: 6 });
    const expected = Math.round(500 * DAYS * 3 * 0.12 * 100) / 100;
    expect(out.breakdown.interactiveRetention).toBeCloseTo(expected, 2);
  });

  it("charges data search per TB scanned", () => {
    const out = estimateMonthlyCost({ analyticsGbPerDay: 0, searchTbPerMonth: 500 });
    expect(out.breakdown.dataSearch).toBe(3000);
  });

  it("includes the SOAR free-action allowance", () => {
    const free = estimateMonthlyCost({ analyticsGbPerDay: 0, soarActionsPerMonth: 4000 });
    expect(free.breakdown.soar).toBe(0);
    const paid = estimateMonthlyCost({ analyticsGbPerDay: 0, soarActionsPerMonth: 5000 });
    // 1000 actions × $0.000015 = $0.015, rounded to cents.
    expect(paid.breakdown.soar).toBe(0.02);
  });

  it("prices Security Copilot and SAP per the rate card", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 0,
      securityCopilotScu: 2,
      sapProductionSids: 1,
    });
    expect(out.breakdown.securityCopilot).toBe(5800);
    expect(out.breakdown.sap).toBe(1400);
  });

  it("applies an ingestion optimization discount to Analytics ingestion", () => {
    const base = estimateMonthlyCost({ analyticsGbPerDay: 500 });
    const opt = estimateMonthlyCost({ analyticsGbPerDay: 500, ingestionOptimizationPct: 0.1 });
    expect(opt.breakdown.analyticsIngestion).toBeCloseTo(
      base.breakdown.analyticsIngestion * 0.9,
      1,
    );
  });

  it("honors rate overrides", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 100,
      rates: { analyticsIngestPerGb: 0.3 },
    });
    const expected = Math.round(100 * DAYS * 0.3 * 100) / 100;
    expect(out.breakdown.analyticsIngestion).toBeCloseTo(expected, 2);
  });

  it("builds commitment options including PAYG baseline", () => {
    const out = estimateMonthlyCost({ analyticsGbPerDay: 250 });
    expect(out.commitment).toBeDefined();
    expect(out.commitment?.options[0]?.tierGbPerDay).toBeNull();
    expect(out.commitment?.options.some((o) => o.tierGbPerDay === 100)).toBe(true);
  });

  it("auto-selects the right-sized commitment tier below sustained usage", () => {
    const out = estimateMonthlyCost({ analyticsGbPerDay: 280, commitmentTierMode: "auto" });
    expect(out.commitment?.recommendedTierGbPerDay).toBe(200);
    expect(out.commitment?.selectedTierGbPerDay).toBe(200);
    const selected = out.commitment?.options.find((o) => o.selected);
    expect(selected?.tierGbPerDay).toBe(200);
    expect(out.breakdown.analyticsIngestion).toBeCloseTo(selected?.analyticsMonthlyCost ?? 0, 2);
  });

  it("supports manual commitment tier selection", () => {
    const out = estimateMonthlyCost({
      analyticsGbPerDay: 320,
      commitmentTierMode: "manual",
      commitmentTierGbPerDay: 500,
    });
    expect(out.commitment?.selectedTierGbPerDay).toBe(500);
    const selected = out.commitment?.options.find((o) => o.selected);
    expect(selected?.tierGbPerDay).toBe(500);
  });

  it("sums the breakdown into the monthly total", () => {
    const out = estimateMonthlyCost(sample as SentinelCostInput);
    const sum = Object.values(out.breakdown).reduce((a, b) => a + b, 0);
    expect(out.monthlyCost).toBeCloseTo(Math.round(sum * 100) / 100, 2);
    expect(out.monthlyCost).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(estimateMonthlyCost(sample as SentinelCostInput)).toEqual(
      estimateMonthlyCost(sample as SentinelCostInput),
    );
  });
});

describe("estimateMonthlyCostFromResult", () => {
  it("uses the normalized total GB/day as Analytics ingestion", () => {
    const result: NormalizedResult = {
      vendor: "sentinel",
      sources: [{ name: "SecurityEvent", gbPerDay: 100 }],
      totals: { gbPerDay: 100 },
    };
    const out = estimateMonthlyCostFromResult(result);
    const expected = Math.round(100 * DAYS * 0.15 * 100) / 100;
    expect(out.breakdown.analyticsIngestion).toBeCloseTo(expected, 2);
  });

  it("treats a missing total as zero", () => {
    const result: NormalizedResult = { vendor: "sentinel", sources: [] };
    expect(estimateMonthlyCostFromResult(result).monthlyCost).toBe(0);
  });
});
