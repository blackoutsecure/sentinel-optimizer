/**
 * Microsoft Sentinel cost model.
 *
 * Converts normalized ingestion volume (GB/day) into an estimated monthly cost
 * breakdown using Microsoft Sentinel's public, per-GB list pricing. All rates
 * are configurable; defaults reflect the public pricing pages (USD, US East).
 *
 * Pure and deterministic: no I/O, no network, no globals.
 */

import { type NormalizedResult } from "../schema/normalization.js";

/** Configurable pricing rates. Defaults are public list prices (USD). */
export interface SentinelRates {
  /** Analytics (Log Analytics) ingestion, per GB. */
  analyticsIngestPerGb: number;
  /** Data Lake ingestion, per GB (lower-cost tier; override per region/plan). */
  dataLakeIngestPerGb: number;
  /** Interactive retention beyond the free window, per GB per month. */
  interactiveRetentionPerGbMonth: number;
  /** Interactive retention months included at no cost. */
  freeInteractiveRetentionMonths: number;
  /** Long-term data storage, per GB per month. */
  dataStoragePerGbMonth: number;
  /** Data search/query, per TB scanned. */
  dataSearchPerTb: number;
  /** SOAR (Logic Apps) actions included at no cost per month. */
  soarFreeActions: number;
  /** SOAR cost per action beyond the free allowance. */
  soarPerAction: number;
  /** Security Copilot, per Security Compute Unit (SCU) per month. */
  securityCopilotPerScuMonth: number;
  /** Sentinel for SAP, per billable SID per month (plus ingestion). */
  sapPerSidMonth: number;
  /** Days per month used to convert per-day volume to per-month. */
  daysPerMonth: number;
}

export const DEFAULT_SENTINEL_RATES: SentinelRates = {
  analyticsIngestPerGb: 0.15,
  dataLakeIngestPerGb: 0.1,
  interactiveRetentionPerGbMonth: 0.12,
  freeInteractiveRetentionMonths: 3,
  dataStoragePerGbMonth: 0.0043,
  dataSearchPerTb: 6,
  soarFreeActions: 4000,
  soarPerAction: 0.000015,
  securityCopilotPerScuMonth: 2900,
  sapPerSidMonth: 1400,
  daysPerMonth: 365 / 12,
};

/** Free-ingestion benefits that reduce billable Analytics volume. */
export interface SentinelBenefits {
  /** Microsoft 365 E5/A5/F5/G5 grant (≈5 MB/user/day), in GB/day. */
  m365E5FreeGbPerDay?: number;
  /** Defender for Servers P2 grant (500 MB/node/day), in GB/day. */
  defenderP2FreeGbPerDay?: number;
  /** Always-free data sources (Activity logs, O365 audit, alerts), in GB/day. */
  freeDataSourceGbPerDay?: number;
}

export interface SentinelCostInput {
  /** Analytics (Log Analytics) ingestion, GB/day. */
  analyticsGbPerDay: number;
  /** Data Lake ingestion, GB/day. */
  dataLakeGbPerDay?: number;
  /** Total interactive retention window in months. Defaults to the free window. */
  interactiveRetentionMonths?: number;
  /** Long-term storage retention in months. Defaults to 12. */
  dataStorageMonths?: number;
  /** Data searched against long-term storage, TB/month. */
  searchTbPerMonth?: number;
  /** SOAR (Logic Apps) actions per month. */
  soarActionsPerMonth?: number;
  /** Security Copilot capacity, in SCUs. */
  securityCopilotScu?: number;
  /** Billable Sentinel for SAP SIDs (Production/Unknown). */
  sapProductionSids?: number;
  /** Free-ingestion benefits applied to Analytics volume. */
  benefits?: SentinelBenefits;
  /** Weekend/holiday ingestion optimization, 0..1, applied to Analytics ingestion. */
  ingestionOptimizationPct?: number;
  /** Rate overrides (region, currency, negotiated tiers). */
  rates?: Partial<SentinelRates>;
}

export interface SentinelCostBreakdown {
  analyticsIngestion: number;
  dataLakeIngestion: number;
  interactiveRetention: number;
  dataStorage: number;
  dataSearch: number;
  soar: number;
  securityCopilot: number;
  sap: number;
}

export interface SentinelCostEstimate {
  monthlyCost: number;
  breakdown: SentinelCostBreakdown;
  /** Analytics GB/day actually billed after benefits. */
  billableAnalyticsGbPerDay: number;
  /** Free GB/day covered by benefits. */
  benefitGbPerDay: number;
  /** Estimated monthly value of the applied benefits. */
  estimatedMonthlyBenefitValue: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Estimate the monthly Sentinel cost from ingestion volume and options. */
export function estimateMonthlyCost(input: SentinelCostInput): SentinelCostEstimate {
  const rates: SentinelRates = { ...DEFAULT_SENTINEL_RATES, ...input.rates };

  const benefits = input.benefits ?? {};
  const benefitGbPerDay = Math.max(
    0,
    (benefits.m365E5FreeGbPerDay ?? 0) +
      (benefits.defenderP2FreeGbPerDay ?? 0) +
      (benefits.freeDataSourceGbPerDay ?? 0),
  );

  const analyticsGbPerDay = Math.max(0, input.analyticsGbPerDay);
  const billableAnalyticsGbPerDay = Math.max(0, analyticsGbPerDay - benefitGbPerDay);

  const billableAnalyticsMonthlyGb = billableAnalyticsGbPerDay * rates.daysPerMonth;
  const totalAnalyticsMonthlyGb = analyticsGbPerDay * rates.daysPerMonth;
  const dataLakeMonthlyGb = Math.max(0, input.dataLakeGbPerDay ?? 0) * rates.daysPerMonth;

  const optPct = clamp(input.ingestionOptimizationPct ?? 0, 0, 1);
  const analyticsIngestion =
    billableAnalyticsMonthlyGb * rates.analyticsIngestPerGb * (1 - optPct);
  const dataLakeIngestion = dataLakeMonthlyGb * rates.dataLakeIngestPerGb;

  const interactiveMonths =
    input.interactiveRetentionMonths ?? rates.freeInteractiveRetentionMonths;
  const paidInteractiveMonths = Math.max(
    0,
    interactiveMonths - rates.freeInteractiveRetentionMonths,
  );
  const interactiveRetention =
    totalAnalyticsMonthlyGb * paidInteractiveMonths * rates.interactiveRetentionPerGbMonth;

  const storageMonths = input.dataStorageMonths ?? 12;
  const dataStorage =
    (totalAnalyticsMonthlyGb + dataLakeMonthlyGb) *
    storageMonths *
    rates.dataStoragePerGbMonth;

  const dataSearch = Math.max(0, input.searchTbPerMonth ?? 0) * rates.dataSearchPerTb;

  const soar =
    Math.max(0, (input.soarActionsPerMonth ?? 0) - rates.soarFreeActions) *
    rates.soarPerAction;

  const securityCopilot =
    Math.max(0, input.securityCopilotScu ?? 0) * rates.securityCopilotPerScuMonth;

  const sap = Math.max(0, input.sapProductionSids ?? 0) * rates.sapPerSidMonth;

  const breakdown: SentinelCostBreakdown = {
    analyticsIngestion: round2(analyticsIngestion),
    dataLakeIngestion: round2(dataLakeIngestion),
    interactiveRetention: round2(interactiveRetention),
    dataStorage: round2(dataStorage),
    dataSearch: round2(dataSearch),
    soar: round2(soar),
    securityCopilot: round2(securityCopilot),
    sap: round2(sap),
  };

  const monthlyCost = round2(
    analyticsIngestion +
      dataLakeIngestion +
      interactiveRetention +
      dataStorage +
      dataSearch +
      soar +
      securityCopilot +
      sap,
  );

  return {
    monthlyCost,
    breakdown,
    billableAnalyticsGbPerDay: round2(billableAnalyticsGbPerDay),
    benefitGbPerDay: round2(benefitGbPerDay),
    estimatedMonthlyBenefitValue: round2(
      benefitGbPerDay * rates.daysPerMonth * rates.analyticsIngestPerGb,
    ),
  };
}

/**
 * Estimate monthly cost from a {@link NormalizedResult}, using its total
 * GB/day as Analytics ingestion. Additional options (Data Lake, retention,
 * benefits, etc.) may be supplied via `options`.
 */
export function estimateMonthlyCostFromResult(
  result: NormalizedResult,
  options: Omit<SentinelCostInput, "analyticsGbPerDay"> = {},
): SentinelCostEstimate {
  return estimateMonthlyCost({
    analyticsGbPerDay: result.totals?.gbPerDay ?? 0,
    ...options,
  });
}
