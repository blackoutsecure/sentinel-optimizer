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
import { ratesForRegion } from "./regions.js";

/** Configurable pricing rates. Defaults are public list prices (USD). */
export interface SentinelRates {
  /** Analytics (Log Analytics) ingestion, per GB. */
  analyticsIngestPerGb: number;
  /** Basic / Auxiliary logs ingestion, per GB (cheaper tier, limited query/retention). */
  basicIngestPerGb: number;
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
  /** Commitment-tier options for Analytics ingestion. */
  commitmentTiers: SentinelCommitmentTier[];
  /** Days per month used to convert per-day volume to per-month. */
  daysPerMonth: number;
}

/** Sentinel Analytics commitment tier definition. */
export interface SentinelCommitmentTier {
  /** Tier capacity in GB/day. */
  gbPerDay: number;
  /** Discount vs pay-as-you-go Analytics ingestion, 0..1. */
  discountPct: number;
  /** Optional display label. */
  label?: string;
}

/** Commitment-tier modeling mode for Analytics ingestion. */
export type CommitmentTierMode = "off" | "auto" | "manual";

export const DEFAULT_SENTINEL_RATES: SentinelRates = {
  analyticsIngestPerGb: 0.15,
  basicIngestPerGb: 0.05,
  dataLakeIngestPerGb: 0.1,
  interactiveRetentionPerGbMonth: 0.12,
  freeInteractiveRetentionMonths: 3,
  dataStoragePerGbMonth: 0.0043,
  dataSearchPerTb: 6,
  soarFreeActions: 4000,
  soarPerAction: 0.000015,
  securityCopilotPerScuMonth: 2900,
  sapPerSidMonth: 1400,
  // Public tier pricing is region/offer-dependent; model as configurable
  // discounts to support directional planning without hard-coding contracts.
  commitmentTiers: [
    { gbPerDay: 100, discountPct: 0.15, label: "100 GB/day" },
    { gbPerDay: 200, discountPct: 0.2, label: "200 GB/day" },
    { gbPerDay: 300, discountPct: 0.25, label: "300 GB/day" },
    { gbPerDay: 500, discountPct: 0.3, label: "500 GB/day" },
    { gbPerDay: 1000, discountPct: 0.35, label: "1 TB/day" },
    { gbPerDay: 2000, discountPct: 0.4, label: "2 TB/day" },
    { gbPerDay: 5000, discountPct: 0.5, label: "5 TB/day" },
  ],
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

/**
 * Per-table (per-source) retention configuration. Sentinel lets each table set
 * its own retention, so high-value tables can be kept longer while noisy tables
 * are trimmed. The Analytics free interactive window is 90 days (~3 months).
 *
 * Docs: https://learn.microsoft.com/azure/sentinel/manage-data-overview
 */
export interface TableRetention {
  /** Table / source name (ideally matches a NormalizedResult source). */
  name: string;
  /** Daily ingest for this table, GB/day. */
  gbPerDay: number;
  /** Total interactive retention, months. Default 3 (90 days, free with Sentinel). */
  interactiveMonths?: number;
  /**
   * Total retention including long-term archive, months. Months beyond the
   * interactive window are billed at the long-term storage rate. Default =
   * interactiveMonths (no archive).
   */
  totalMonths?: number;
}

export interface SentinelCostInput {
  /** Analytics (Log Analytics) ingestion, GB/day. */
  analyticsGbPerDay: number;
  /** Azure region / datacenter for pricing (drives region-aware rates). */
  regionId?: string;
  /** Data Lake ingestion, GB/day. */
  dataLakeGbPerDay?: number;
  /** Total interactive retention window in months. Defaults to the free window. */
  interactiveRetentionMonths?: number;
  /** Long-term storage retention in months. Defaults to 12. */
  dataStorageMonths?: number;
  /**
   * Per-table retention overrides. When provided (non-empty), interactive
   * retention and long-term storage are computed per table instead of from the
   * aggregate `interactiveRetentionMonths` / `dataStorageMonths` window.
   */
  tableRetention?: TableRetention[];
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
  /** Commitment-tier modeling mode for Analytics ingestion. */
  commitmentTierMode?: CommitmentTierMode;
  /** Manual commitment tier selection (GB/day), used when mode is "manual". */
  commitmentTierGbPerDay?: number;
  /** Rate overrides (region, currency, negotiated tiers). */
  rates?: Partial<SentinelRates>;
}

export interface SentinelCommitmentOption {
  /** PAYG (null) or commitment tier in GB/day. */
  tierGbPerDay: number | null;
  /** Human-readable label. */
  label: string;
  /** Discount vs PAYG Analytics ingestion. */
  discountPct: number;
  /** Effective Analytics ingestion rate for this option. */
  effectiveRatePerGb: number;
  /** Estimated Analytics monthly cost under this option. */
  analyticsMonthlyCost: number;
  /** Estimated total monthly Sentinel cost under this option. */
  estimatedMonthlyTotalCost: number;
  /** Savings vs PAYG Analytics ingestion. */
  estimatedMonthlySavingsVsPayg: number;
  /** Tier utilization for commitment options; null for PAYG. */
  utilizationPct: number | null;
  /** Overage volume billed above tier capacity, GB/day. */
  overageGbPerDay: number;
  /** True when this is the selected pricing model option. */
  selected: boolean;
  /** True when this is the recommended tier-sized option. */
  recommended: boolean;
}

export interface SentinelCommitmentModel {
  mode: CommitmentTierMode;
  recommendedTierGbPerDay?: number;
  selectedTierGbPerDay?: number;
  options: SentinelCommitmentOption[];
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
  /** The fully-resolved rate table used for this estimate (region-adjusted). */
  rates: SentinelRates;
  /** The region id these rates were resolved for, if any. */
  regionId?: string;
  /** Commitment-tier modeling and ranked options. */
  commitment?: SentinelCommitmentModel;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sortedCommitmentTiers(tiers: SentinelCommitmentTier[]): SentinelCommitmentTier[] {
  return [...tiers]
    .filter((t) => t.gbPerDay > 0)
    .sort((a, b) => a.gbPerDay - b.gbPerDay)
    .map((t) => ({
      ...t,
      discountPct: clamp(t.discountPct, 0, 0.95),
      ...(t.label ? {} : { label: `${t.gbPerDay} GB/day` }),
    }));
}

/** Estimate the monthly Sentinel cost from ingestion volume and options. */
export function estimateMonthlyCost(input: SentinelCostInput): SentinelCostEstimate {
  const regionRates = input.regionId
    ? ratesForRegion(input.regionId)
    : DEFAULT_SENTINEL_RATES;
  const rates: SentinelRates = { ...regionRates, ...input.rates };

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
  const paygAnalyticsIngestion =
    billableAnalyticsMonthlyGb * rates.analyticsIngestPerGb * (1 - optPct);
  let analyticsIngestion = paygAnalyticsIngestion;
  const dataLakeIngestion = dataLakeMonthlyGb * rates.dataLakeIngestPerGb;

  const interactiveMonths =
    input.interactiveRetentionMonths ?? rates.freeInteractiveRetentionMonths;
  const storageMonths = input.dataStorageMonths ?? 12;

  let interactiveRetention: number;
  let dataStorage: number;

  const perTable = input.tableRetention?.filter((t) => (t.gbPerDay ?? 0) > 0) ?? [];
  if (perTable.length > 0) {
    // Per-table retention: each table sets its own interactive + total window.
    let interactive = 0;
    let archive = 0;
    for (const t of perTable) {
      const monthlyGb = Math.max(0, t.gbPerDay) * rates.daysPerMonth;
      const tInteractive = t.interactiveMonths ?? rates.freeInteractiveRetentionMonths;
      const tTotal = Math.max(t.totalMonths ?? tInteractive, tInteractive);
      const paidInteractive = Math.max(0, tInteractive - rates.freeInteractiveRetentionMonths);
      const archiveMonths = Math.max(0, tTotal - tInteractive);
      interactive += monthlyGb * paidInteractive * rates.interactiveRetentionPerGbMonth;
      archive += monthlyGb * archiveMonths * rates.dataStoragePerGbMonth;
    }
    interactiveRetention = interactive;
    dataStorage = archive;
  } else {
    // Aggregate retention across all Analytics + Data Lake volume.
    const paidInteractiveMonths = Math.max(
      0,
      interactiveMonths - rates.freeInteractiveRetentionMonths,
    );
    interactiveRetention =
      totalAnalyticsMonthlyGb * paidInteractiveMonths * rates.interactiveRetentionPerGbMonth;
    dataStorage =
      (totalAnalyticsMonthlyGb + dataLakeMonthlyGb) *
      storageMonths *
      rates.dataStoragePerGbMonth;
  }

  const dataSearch = Math.max(0, input.searchTbPerMonth ?? 0) * rates.dataSearchPerTb;

  const soar =
    Math.max(0, (input.soarActionsPerMonth ?? 0) - rates.soarFreeActions) *
    rates.soarPerAction;

  const securityCopilot =
    Math.max(0, input.securityCopilotScu ?? 0) * rates.securityCopilotPerScuMonth;

  const sap = Math.max(0, input.sapProductionSids ?? 0) * rates.sapPerSidMonth;

  const commitmentMode = input.commitmentTierMode ?? "off";
  const tierCandidates = sortedCommitmentTiers(rates.commitmentTiers);
  const effectiveBillableAnalyticsGbPerDay = billableAnalyticsGbPerDay * (1 - optPct);
  const minTierGb = tierCandidates[0]?.gbPerDay;
  const recommendedTierGbPerDay =
    minTierGb != null && effectiveBillableAnalyticsGbPerDay >= minTierGb
      ? tierCandidates
          .filter((t) => t.gbPerDay <= effectiveBillableAnalyticsGbPerDay)
          .at(-1)?.gbPerDay
      : undefined;

  const selectedTierGbPerDay =
    commitmentMode === "manual"
      ? tierCandidates.find((t) => t.gbPerDay === input.commitmentTierGbPerDay)?.gbPerDay
      : commitmentMode === "auto"
        ? recommendedTierGbPerDay
        : undefined;

  if (selectedTierGbPerDay != null) {
    const tier = tierCandidates.find((t) => t.gbPerDay === selectedTierGbPerDay);
    if (tier) {
      const tierRate = rates.analyticsIngestPerGb * (1 - tier.discountPct);
      const billedMonthlyGb =
        Math.max(effectiveBillableAnalyticsGbPerDay, tier.gbPerDay) * rates.daysPerMonth;
      analyticsIngestion = billedMonthlyGb * tierRate;
    }
  }

  const nonAnalyticsTotal =
    dataLakeIngestion +
    interactiveRetention +
    dataStorage +
    dataSearch +
    soar +
    securityCopilot +
    sap;

  const options: SentinelCommitmentOption[] = [
    {
      tierGbPerDay: null,
      label: "PAYG (no commitment)",
      discountPct: 0,
      effectiveRatePerGb: round2(rates.analyticsIngestPerGb),
      analyticsMonthlyCost: round2(paygAnalyticsIngestion),
      estimatedMonthlyTotalCost: round2(paygAnalyticsIngestion + nonAnalyticsTotal),
      estimatedMonthlySavingsVsPayg: 0,
      utilizationPct: null,
      overageGbPerDay: 0,
      selected: selectedTierGbPerDay == null,
      recommended: false,
    },
    ...tierCandidates.map((tier) => {
      const tierRate = rates.analyticsIngestPerGb * (1 - tier.discountPct);
      const billedDaily = Math.max(effectiveBillableAnalyticsGbPerDay, tier.gbPerDay);
      const analyticsMonthly = billedDaily * rates.daysPerMonth * tierRate;
      const savings = paygAnalyticsIngestion - analyticsMonthly;
      const utilization =
        tier.gbPerDay > 0 ? effectiveBillableAnalyticsGbPerDay / tier.gbPerDay : 0;
      return {
        tierGbPerDay: tier.gbPerDay,
        label: tier.label ?? `${tier.gbPerDay} GB/day`,
        discountPct: round2(tier.discountPct),
        effectiveRatePerGb: round2(tierRate),
        analyticsMonthlyCost: round2(analyticsMonthly),
        estimatedMonthlyTotalCost: round2(analyticsMonthly + nonAnalyticsTotal),
        estimatedMonthlySavingsVsPayg: round2(savings),
        utilizationPct: round2(utilization),
        overageGbPerDay: round2(
          Math.max(0, effectiveBillableAnalyticsGbPerDay - tier.gbPerDay),
        ),
        selected: selectedTierGbPerDay === tier.gbPerDay,
        recommended: recommendedTierGbPerDay === tier.gbPerDay,
      } satisfies SentinelCommitmentOption;
    }),
  ];

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
    rates,
    ...(input.regionId ? { regionId: input.regionId } : {}),
    commitment: {
      mode: commitmentMode,
      ...(recommendedTierGbPerDay != null ? { recommendedTierGbPerDay } : {}),
      ...(selectedTierGbPerDay != null ? { selectedTierGbPerDay } : {}),
      options,
    },
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
