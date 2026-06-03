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
  SentinelCommitmentTier,
  CommitmentTierMode,
  SentinelCommitmentOption,
  SentinelCommitmentModel,
  SentinelRates,
  SentinelBenefits,
  SentinelCostInput,
  SentinelCostBreakdown,
  SentinelCostEstimate,
  TableRetention,
} from "./sentinelPricing.js";
export {
  SENTINEL_REGIONS,
  DEFAULT_REGION_ID,
  regionById,
  ratesForRegion,
  cheapestRegion,
} from "./regions.js";
export type { SentinelRegion } from "./regions.js";
