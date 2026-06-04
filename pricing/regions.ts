/**
 * Microsoft Sentinel region registry.
 *
 * Sentinel runs on Log Analytics workspaces, and the per-GB list price varies
 * by Azure region. An organization can run **multiple workspaces across
 * multiple regions** (data residency, sovereignty, RBAC, latency, or cost), so
 * the estimator lets you pick a datacenter location and compare prices.
 *
 * Rates here are public-list **estimates** in USD, expressed relative to the
 * US base price ($0.15/GB Analytics). They are configurable and deliberately
 * approximate — always confirm against the Azure Pricing Calculator. This file
 * is pure data + pure helpers: no I/O, no network, no globals.
 *
 * Docs: https://learn.microsoft.com/azure/sentinel/use-multiple-workspaces
 */

import { DEFAULT_SENTINEL_RATES, type SentinelRates } from "./sentinelPricing.js";

/**
 * Regional baseline maintenance metadata.
 *
 * Update process:
 * 1) Re-check region deltas against current public pricing pages.
 * 2) Update `SENTINEL_REGIONS` entries.
 * 3) Bump `REGION_PRICING_LAST_REVIEWED`.
 */
export const REGION_PRICING_LAST_REVIEWED = "2026-06-04";

export const REGION_PRICING_SOURCES = {
  sentinelPricingPage:
    "https://azure.microsoft.com/en-us/pricing/details/microsoft-sentinel/",
  monitorPricingPage:
    "https://azure.microsoft.com/en-us/pricing/details/monitor/",
  sentinelBillingDoc:
    "https://learn.microsoft.com/en-us/azure/sentinel/billing",
} as const;

/** A supported Sentinel / Log Analytics region. */
export interface SentinelRegion {
  /** Azure region id, e.g. "eastus". */
  id: string;
  /** Human label, e.g. "East US". */
  label: string;
  /** Geography grouping for the picker. */
  geo: "Americas" | "Europe" | "Asia Pacific" | "Middle East" | "Africa";
  /** Estimated Analytics (pay-as-you-go) ingestion price, USD per GB. */
  analyticsIngestPerGb: number;
}

/**
 * Curated set of common Sentinel regions with **estimated** Analytics per-GB
 * list prices (USD). US regions anchor the base $0.15/GB; other geographies
 * carry the usual regional uplift. Treat as ballpark, not a quote.
 */
export const SENTINEL_REGIONS: readonly SentinelRegion[] = [
  // Americas
  { id: "eastus", label: "East US", geo: "Americas", analyticsIngestPerGb: 0.15 },
  { id: "eastus2", label: "East US 2", geo: "Americas", analyticsIngestPerGb: 0.15 },
  { id: "centralus", label: "Central US", geo: "Americas", analyticsIngestPerGb: 0.15 },
  { id: "southcentralus", label: "South Central US", geo: "Americas", analyticsIngestPerGb: 0.15 },
  { id: "westus2", label: "West US 2", geo: "Americas", analyticsIngestPerGb: 0.15 },
  { id: "westus3", label: "West US 3", geo: "Americas", analyticsIngestPerGb: 0.15 },
  { id: "canadacentral", label: "Canada Central", geo: "Americas", analyticsIngestPerGb: 0.155 },
  { id: "brazilsouth", label: "Brazil South", geo: "Americas", analyticsIngestPerGb: 0.21 },
  // Europe
  { id: "northeurope", label: "North Europe", geo: "Europe", analyticsIngestPerGb: 0.155 },
  { id: "westeurope", label: "West Europe", geo: "Europe", analyticsIngestPerGb: 0.16 },
  { id: "uksouth", label: "UK South", geo: "Europe", analyticsIngestPerGb: 0.16 },
  { id: "swedencentral", label: "Sweden Central", geo: "Europe", analyticsIngestPerGb: 0.16 },
  { id: "francecentral", label: "France Central", geo: "Europe", analyticsIngestPerGb: 0.165 },
  { id: "germanywestcentral", label: "Germany West Central", geo: "Europe", analyticsIngestPerGb: 0.17 },
  { id: "switzerlandnorth", label: "Switzerland North", geo: "Europe", analyticsIngestPerGb: 0.19 },
  // Asia Pacific
  { id: "southeastasia", label: "Southeast Asia", geo: "Asia Pacific", analyticsIngestPerGb: 0.165 },
  { id: "eastasia", label: "East Asia", geo: "Asia Pacific", analyticsIngestPerGb: 0.17 },
  { id: "australiaeast", label: "Australia East", geo: "Asia Pacific", analyticsIngestPerGb: 0.17 },
  { id: "japaneast", label: "Japan East", geo: "Asia Pacific", analyticsIngestPerGb: 0.17 },
  { id: "koreacentral", label: "Korea Central", geo: "Asia Pacific", analyticsIngestPerGb: 0.165 },
  { id: "centralindia", label: "Central India", geo: "Asia Pacific", analyticsIngestPerGb: 0.16 },
  // Middle East / Africa
  { id: "uaenorth", label: "UAE North", geo: "Middle East", analyticsIngestPerGb: 0.18 },
  { id: "southafricanorth", label: "South Africa North", geo: "Africa", analyticsIngestPerGb: 0.18 },
];

/** Default region used when none is selected. */
export const DEFAULT_REGION_ID = "eastus";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Look up a region by id (case-insensitive). Returns undefined if unknown. */
export function regionById(id: string | undefined): SentinelRegion | undefined {
  if (!id) return undefined;
  const key = id.toLowerCase();
  return SENTINEL_REGIONS.find((r) => r.id === key);
}

/**
 * Resolve a full {@link SentinelRates} table for a region by scaling the
 * volume-based rates (ingestion, retention, storage, search) by the region's
 * price index relative to the US base. Global, non-regional rates
 * (SOAR/Copilot/SAP and free allowances) are left unchanged.
 */
export function ratesForRegion(
  regionId: string | undefined,
  base: SentinelRates = DEFAULT_SENTINEL_RATES,
): SentinelRates {
  const region = regionById(regionId);
  if (!region) return { ...base };
  const m = region.analyticsIngestPerGb / DEFAULT_SENTINEL_RATES.analyticsIngestPerGb;
  return {
    ...base,
    analyticsIngestPerGb: round4(base.analyticsIngestPerGb * m),
    basicIngestPerGb: round4(base.basicIngestPerGb * m),
    dataLakeIngestPerGb: round4(base.dataLakeIngestPerGb * m),
    interactiveRetentionPerGbMonth: round4(base.interactiveRetentionPerGbMonth * m),
    dataStoragePerGbMonth: round4(base.dataStoragePerGbMonth * m),
    dataSearchPerTb: round4(base.dataSearchPerTb * m),
  };
}

/** The region with the lowest Analytics ingestion price. */
export function cheapestRegion(
  regions: readonly SentinelRegion[] = SENTINEL_REGIONS,
): SentinelRegion {
  return regions.reduce((best, r) =>
    r.analyticsIngestPerGb < best.analyticsIngestPerGb ? r : best,
  );
}
