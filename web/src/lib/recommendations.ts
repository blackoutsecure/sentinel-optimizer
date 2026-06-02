/**
 * Deterministic recommendation engine.
 *
 * Pure, client-side rules that turn a normalized SIEM result + a Sentinel cost
 * estimate into prioritized, actionable recommendations with rough monthly
 * savings. This is the always-on baseline — it works offline and never sends
 * data anywhere. The optional "Enhance with AI" feature layers richer narrative
 * on top of these same numbers (aggregated only).
 *
 * Savings figures are intentionally conservative, public-rate estimates meant
 * for directional planning — not quotes.
 */

import type { NormalizedResult } from "@engine/schema/normalization.js";
import type {
  SentinelCostEstimate,
  SentinelCostInput,
  SentinelRates,
} from "@engine/pricing/sentinelPricing.js";
import { DEFAULT_SENTINEL_RATES } from "@engine/pricing/index.js";

export type Severity = "high" | "med" | "low";

export interface Recommendation {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Estimated monthly USD savings, if quantifiable. */
  monthlySavings?: number;
}

/** Source-name fragments that are typically high-volume / lower-signal. */
const VERBOSE_HINTS = [
  "commonsecuritylog",
  "firewall",
  "netflow",
  "flow",
  "proxy",
  "syslog",
  "w3cidsiislog",
  "dns",
  "perf",
];

function isVerbose(name: string): boolean {
  const n = name.toLowerCase();
  return VERBOSE_HINTS.some((h) => n.includes(h));
}

export interface RecommendationContext {
  result: NormalizedResult;
  cost: SentinelCostEstimate;
  input: SentinelCostInput;
}

export function generateRecommendations(ctx: RecommendationContext): Recommendation[] {
  const { result, cost, input } = ctx;
  const rates: SentinelRates = { ...DEFAULT_SENTINEL_RATES, ...input.rates };
  const recs: Recommendation[] = [];

  const sources = [...result.sources].sort((a, b) => (b.gbPerDay ?? 0) - (a.gbPerDay ?? 0));
  const totalGbPerDay = result.totals?.gbPerDay ?? sources.reduce((a, s) => a + (s.gbPerDay ?? 0), 0);
  const monthlyGb = totalGbPerDay * rates.daysPerMonth;

  // 1) Single-source concentration.
  const top = sources[0];
  if (top && totalGbPerDay > 0) {
    const share = (top.gbPerDay ?? 0) / totalGbPerDay;
    if (share >= 0.4) {
      // Filtering 20% of the dominant source's analytics volume via DCR transforms.
      const savings = (top.gbPerDay ?? 0) * 0.2 * rates.daysPerMonth * rates.analyticsIngestPerGb;
      recs.push({
        id: "concentration",
        severity: share >= 0.6 ? "high" : "med",
        title: `"${top.name}" drives ${(share * 100).toFixed(0)}% of your ingest`,
        detail:
          "A single source dominates volume. Apply a Data Collection Rule (DCR) transformation to drop noisy fields/events at ingestion — typically 15–30% reducible with no detection loss.",
        monthlySavings: round(savings),
      });
    }
  }

  // 2) High-volume, lower-signal sources → cheaper Data Lake / Auxiliary tier.
  const verbose = sources.filter((s) => isVerbose(s.name) && (s.gbPerDay ?? 0) > 0);
  const verboseGbPerDay = verbose.reduce((a, s) => a + (s.gbPerDay ?? 0), 0);
  if (verboseGbPerDay > 0) {
    // Moving from Analytics ($0.15) to Data Lake/Auxiliary ($0.10) per GB.
    const delta = rates.analyticsIngestPerGb - rates.dataLakeIngestPerGb;
    const savings = verboseGbPerDay * rates.daysPerMonth * delta;
    if (savings >= 1) {
      recs.push({
        id: "tiering",
        severity: savings > 500 ? "high" : "med",
        title: `Route ${verbose.length} high-volume source(s) to the Auxiliary / Data Lake tier`,
        detail: `Sources like ${verbose
          .slice(0, 3)
          .map((s) => `"${s.name}"`)
          .join(
            ", ",
          )} are usually retained for hunting/compliance rather than real-time analytics. The lake/auxiliary plan ingests them at a lower per-GB rate.`,
        monthlySavings: round(savings),
      });
    }
  }

  // 3a) Microsoft 365 E5 free-ingestion benefit not applied.
  const benefits = input.benefits ?? {};
  const hasM365 = sources.some((s) =>
    /(signinlogs|auditlogs|officeactivity|office365|microsoft365|\baad\b|entra|emailevents|cloudappevents)/i.test(
      s.name,
    ),
  );
  if ((benefits.m365E5FreeGbPerDay ?? 0) === 0 && hasM365 && totalGbPerDay > 0) {
    recs.push({
      id: "benefit-e5",
      severity: "med",
      title: "Apply the Microsoft 365 E5 free-ingestion benefit",
      detail:
        "Microsoft 365 E5/A5/F5/G5 (and standalone Entra ID P2) grants ~5 MB/user/day of free Microsoft Sentinel ingestion. Multiply your eligible user count by 5 MB/day and enter the result under “M365 E5 (GB/day)” in the cost controls to subtract it from billable volume.",
    });
  }

  // 3b) Defender for Servers Plan 2 free-ingestion benefit not applied.
  const hasServerSecurity = sources.some((s) =>
    /(securityevent|windowsfirewall|windowsevent|securitybaseline|securitydetection|protectionstatus|updatesummary|\bupdate\b|mdcfileintegrity|securityalert)/i.test(
      s.name,
    ),
  );
  if ((benefits.defenderP2FreeGbPerDay ?? 0) === 0 && hasServerSecurity && totalGbPerDay > 0) {
    recs.push({
      id: "benefit-defender-servers",
      severity: "med",
      title: "Apply the Defender for Servers Plan 2 free-ingestion benefit",
      detail:
        "Defender for Servers Plan 2 grants 500 MB/node/day of free ingestion into eligible security tables (SecurityEvent, WindowsFirewall, WindowsEvent, ProtectionStatus, Update/UpdateSummary, SecurityBaseline, and more). The allowance is pooled per subscription (nodes × 500 MB). Use the KQL helper in the cost controls to size it, then enter the result under “Defender Servers P2 (GB/day)”.",
    });
  }

  // 4) Commitment tier opportunity at scale.
  if (monthlyGb >= 100 * rates.daysPerMonth) {
    // ≥100 GB/day qualifies for Commitment Tiers (~15–60% off pay-as-you-go).
    const savings = cost.breakdown.analyticsIngestion * 0.2;
    recs.push({
      id: "commitment",
      severity: "high",
      title: "Move to a Sentinel Commitment Tier",
      detail:
        "At ≥100 GB/day, Commitment (capacity reservation) Tiers discount ingestion vs. pay-as-you-go — commonly 15–60% depending on tier. Right-size the tier just below your sustained daily volume.",
      monthlySavings: round(savings),
    });
  }

  // 5) Interactive retention beyond the free window.
  const interactiveMonths = input.interactiveRetentionMonths ?? rates.freeInteractiveRetentionMonths;
  if (cost.breakdown.interactiveRetention > 0 && interactiveMonths > rates.freeInteractiveRetentionMonths + 1) {
    // Difference between interactive retention and long-term storage for the paid months.
    const paidMonths = interactiveMonths - rates.freeInteractiveRetentionMonths;
    const totalAnalyticsMonthlyGb = monthlyGb;
    const interactiveCost = totalAnalyticsMonthlyGb * paidMonths * rates.interactiveRetentionPerGbMonth;
    const storageCost = totalAnalyticsMonthlyGb * paidMonths * rates.dataStoragePerGbMonth;
    const savings = Math.max(0, interactiveCost - storageCost);
    recs.push({
      id: "retention",
      severity: savings > 200 ? "med" : "low",
      title: `Trim interactive retention from ${interactiveMonths} months`,
      detail:
        "Interactive (hot) retention costs far more per GB than long-term storage. Keep only what you actively query interactively (often 90 days) and move the rest to low-cost long-term storage, searching on demand.",
      monthlySavings: round(savings),
    });
  }

  // 6) Ingestion-time optimization not yet modeled.
  const optPct = input.ingestionOptimizationPct ?? 0;
  if (optPct === 0 && cost.breakdown.analyticsIngestion > 50) {
    const savings = cost.breakdown.analyticsIngestion * 0.1;
    recs.push({
      id: "optimization",
      severity: "low",
      title: "Filter at ingestion (workspace transformations)",
      detail:
        "Workspace/DCR transformations can drop verbose columns (e.g. raw payloads, redundant fields) and chatty event IDs before billing. A conservative 10% trim is usually achievable.",
      monthlySavings: round(savings),
    });
  }

  // 7) Disabled connectors → coverage gap (not a cost rec, informational).
  const disabled = (result.connectors ?? []).filter((c) => c.enabled === false);
  if (disabled.length > 0) {
    recs.push({
      id: "coverage",
      severity: "low",
      title: `${disabled.length} data connector(s) are disabled`,
      detail: `Disabled: ${disabled
        .map((c) => c.name)
        .slice(0, 4)
        .join(", ")}. Confirm these are intentional — disabled connectors can leave detection blind spots even though they reduce cost.`,
    });
  }

  // Sort by severity then savings.
  const rank: Record<Severity, number> = { high: 0, med: 1, low: 2 };
  return recs.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (b.monthlySavings ?? 0) - (a.monthlySavings ?? 0),
  );
}

export function totalSavings(recs: Recommendation[]): number {
  return round(recs.reduce((a, r) => a + (r.monthlySavings ?? 0), 0));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
