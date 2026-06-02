/**
 * Pricing registry.
 *
 * Cost models turn normalized ingestion volume into estimated monthly cost
 * using public, per-GB list pricing.
 */

export {
  estimateMonthlyCost,
  estimateMonthlyCostFromResult,
  DEFAULT_SENTINEL_RATES,
} from "./sentinelPricing.js";
export type {
  SentinelRates,
  SentinelBenefits,
  SentinelCostInput,
  SentinelCostBreakdown,
  SentinelCostEstimate,
} from "./sentinelPricing.js";
