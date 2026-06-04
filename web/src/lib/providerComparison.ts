import type { Vendor } from "./examples.js";

export interface ProviderRateCard {
  vendor: Vendor;
  label: string;
  listIngestUsdPerGb: number;
  sourceNote: string;
}

export interface ProviderSpendRow {
  vendor: Vendor;
  label: string;
  listIngestUsdPerGb: number;
  monthlyListSpend: number;
  deltaVsSentinelMonthly: number;
  deltaVsSentinelPct: number;
}

export interface ProviderComparisonModel {
  currentProvider?: ProviderSpendRow;
  sentinel: ProviderSpendRow;
  rows: ProviderSpendRow[];
  modelingNotes: string[];
}

const DAYS_PER_MONTH = 365 / 12;

// Directional public list-rate baseline per GB ingested.
const RATE_CARD: ProviderRateCard[] = [
  { vendor: "sentinel", label: "Microsoft Sentinel", listIngestUsdPerGb: 0.15, sourceNote: "Microsoft Sentinel public list pricing" },
  { vendor: "splunk", label: "Splunk", listIngestUsdPerGb: 0.26, sourceNote: "Splunk public ingest list-rate baseline (directional)" },
  { vendor: "elastic", label: "Elastic", listIngestUsdPerGb: 0.16, sourceNote: "Elastic Cloud list-rate baseline (directional)" },
  { vendor: "rapid7", label: "Rapid7 InsightIDR", listIngestUsdPerGb: 0.2, sourceNote: "Rapid7 list-rate baseline (directional)" },
  { vendor: "qradar", label: "IBM QRadar", listIngestUsdPerGb: 0.19, sourceNote: "QRadar list-rate baseline (directional)" },
  { vendor: "sumologic", label: "Sumo Logic", listIngestUsdPerGb: 0.17, sourceNote: "Sumo Logic list-rate baseline (directional)" },
  { vendor: "logscale", label: "CrowdStrike LogScale", listIngestUsdPerGb: 0.14, sourceNote: "LogScale list-rate baseline (directional)" },
  { vendor: "chronicle", label: "Google SecOps (Chronicle)", listIngestUsdPerGb: 0.18, sourceNote: "Chronicle list-rate baseline (directional)" },
  { vendor: "datadog", label: "Datadog", listIngestUsdPerGb: 0.18, sourceNote: "Datadog logs list-rate baseline (directional)" },
  { vendor: "exabeam", label: "Exabeam", listIngestUsdPerGb: 0.21, sourceNote: "Exabeam list-rate baseline (directional)" },
  { vendor: "logrhythm", label: "LogRhythm", listIngestUsdPerGb: 0.2, sourceNote: "LogRhythm list-rate baseline (directional)" },
  { vendor: "arcticwolf", label: "Arctic Wolf", listIngestUsdPerGb: 0.24, sourceNote: "Arctic Wolf list-rate baseline (directional)" },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildProviderComparison(args: {
  currentVendor?: Vendor;
  totalGbPerDay: number;
  sentinelMonthlyModeledCost: number;
}): ProviderComparisonModel {
  const total = Math.max(0, args.totalGbPerDay);
  const sentinelMonthly = Math.max(0, args.sentinelMonthlyModeledCost);

  const sentinel: ProviderSpendRow = {
    vendor: "sentinel",
    label: "Microsoft Sentinel (modeled)",
    listIngestUsdPerGb: RATE_CARD.find((r) => r.vendor === "sentinel")?.listIngestUsdPerGb ?? 0.15,
    monthlyListSpend: round2(sentinelMonthly),
    deltaVsSentinelMonthly: 0,
    deltaVsSentinelPct: 0,
  };

  const rows: ProviderSpendRow[] = RATE_CARD
    .map((r) => {
      const monthly = round2(total * DAYS_PER_MONTH * r.listIngestUsdPerGb);
      const delta = round2(monthly - sentinelMonthly);
      const deltaPct = sentinelMonthly > 0 ? round2((delta / sentinelMonthly) * 100) : 0;
      return {
        vendor: r.vendor,
        label: r.label,
        listIngestUsdPerGb: r.listIngestUsdPerGb,
        monthlyListSpend: monthly,
        deltaVsSentinelMonthly: delta,
        deltaVsSentinelPct: deltaPct,
      };
    })
    .sort((a, b) => b.monthlyListSpend - a.monthlyListSpend);

  const currentProvider = args.currentVendor
    ? rows.find((r) => r.vendor === args.currentVendor)
    : undefined;

  return {
    ...(currentProvider ? { currentProvider } : {}),
    sentinel,
    rows,
    modelingNotes: [
      "Current-provider and competitor values are directional ingest-only estimates using public list-rate baselines at the same GB/day volume.",
      "Sentinel value uses the full model (lane mix, retention, benefits, commitment tier, and optimization settings), so it is more granular than competitor ingest-only comparisons.",
      "Negotiated contracts, bundled SKUs, and non-ingestion charges can materially change observed spend; validate with vendor quotes and billing exports.",
    ],
  };
}
