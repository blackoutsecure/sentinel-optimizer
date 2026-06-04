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
  /** Optional implementation examples/checklist shown with the recommendation. */
  migrationExamples?: string[];
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

type SourceFamily = "identity" | "firewallFlow" | "endpointServer" | "webProxy" | "dns" | "generic";

function sourceFamilyLabel(family: SourceFamily): string {
  if (family === "identity") return "Identity";
  if (family === "firewallFlow") return "Firewall/Flow";
  if (family === "endpointServer") return "Endpoint/Server";
  if (family === "webProxy") return "Web/Proxy";
  if (family === "dns") return "DNS";
  return "Generic";
}

function classifySourceFamily(name: string): SourceFamily {
  const n = name.toLowerCase();
  if (
    /(signinlogs|auditlogs|officeactivity|microsoft365|office365|cloudappevents|emailevents|\baad\b|entra)/.test(
      n,
    )
  ) {
    return "identity";
  }
  if (/(commonsecuritylog|firewall|netflow|flowlog|flow)/.test(n)) return "firewallFlow";
  if (/(securityevent|windowsevent|sysmon|defender|md4iot|mde|protectionstatus|updatesummary)/.test(n)) {
    return "endpointServer";
  }
  if (/(proxy|w3cidsiislog|iis|http|url)/.test(n)) return "webProxy";
  if (/(dns|dnsquery)/.test(n)) return "dns";
  return "generic";
}

function concentrationMigrationExamples(topSourceName: string): string[] {
  const family = classifySourceFamily(topSourceName);
  const base = [
    "Migrate in phases: baseline 7 days, apply transforms to a non-critical table first, compare ingestion and alert counts, then expand.",
    "If full cutover is risky, run Sentinel in parallel with your current SIEM for 2-4 weeks and use shared success criteria (coverage, latency, fidelity) before cutover.",
  ];

  if (family === "identity") {
    return [
      ...base,
      "Identity example (column trim): source | project-away AppliedConditionalAccessPolicies, AuthenticationDetails, DeviceDetail",
      "Identity example (schema-safe): source | project TimeGenerated, UserPrincipalName, AppDisplayName, IPAddress, ResultType, Location",
    ];
  }
  if (family === "firewallFlow") {
    return [
      ...base,
      "Firewall/flow example (column trim): source | project-away RawData, AdditionalExtensions, Message",
      "Firewall/flow example (noise filter): source | where DeviceAction !in~ ('allow')",
    ];
  }
  if (family === "endpointServer") {
    return [
      ...base,
      "Endpoint/server example (column trim): source | project-away EventData, RenderedDescription",
      "Endpoint/server example (event filter): source | where EventID !in (5156, 5158)",
    ];
  }
  if (family === "webProxy") {
    return [
      ...base,
      "Web/proxy example (column trim): source | project-away UserAgent, Referrer, Cookie",
      "Web/proxy example (noise filter): source | where csUriStem !startswith '/health' and csUriStem !startswith '/metrics'",
    ];
  }
  if (family === "dns") {
    return [
      ...base,
      "DNS example (column trim): source | project-away AdditionalFields, RawData",
      "DNS example (noise filter): source | where QueryType !in~ ('PTR')",
    ];
  }

  return [
    ...base,
    "Generic column trim: source | project-away RawData, Payload, AdditionalFields",
    "Generic row filter: source | where EventLevelName !in ('Informational', 'Verbose')",
  ];
}

function optimizationMigrationExamples(): string[] {
  return [
    "Start with project-away trims before row drops to reduce risk to detections.",
    "Validate each transform with a short parallel run and compare key detection rules before/after.",
    "Keep TimeGenerated and required schema columns in the output to avoid ingestion issues.",
  ];
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
      const topFamily = classifySourceFamily(top.name);
      const familyLabel = sourceFamilyLabel(topFamily);
      // Filtering 20% of the dominant source's analytics volume via DCR transforms.
      const savings = (top.gbPerDay ?? 0) * 0.2 * rates.daysPerMonth * rates.analyticsIngestPerGb;
      recs.push({
        id: "concentration",
        severity: share >= 0.6 ? "high" : "med",
        title:
          topFamily === "generic"
            ? `"${top.name}" drives ${(share * 100).toFixed(0)}% of your ingest`
            : `"${top.name}" drives ${(share * 100).toFixed(0)}% of your ingest (${familyLabel} pattern)`,
        detail:
          topFamily === "generic"
            ? "A single source dominates volume. Apply a Data Collection Rule (DCR) transformation to drop noisy fields/events at ingestion - typically 15-30% reducible with no detection loss."
            : `Detected source family: ${familyLabel}. Apply a Data Collection Rule (DCR) transformation strategy tuned for this pattern to reduce ingest while preserving detection value - typically 15-30% reducible with no detection loss.`,
        migrationExamples: concentrationMigrationExamples(top.name),
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
        "The Microsoft Sentinel benefit for Microsoft 365 E5/A5/F5/G5 customers grants up to 5 MB/user/day of free Sentinel ingestion across eligible Microsoft data types (Microsoft Entra ID logs, Microsoft 365/Office activity, Defender XDR & Defender for Endpoint raw data, Defender for Cloud Apps Shadow IT, and Information Protection). The grant is the lesser of that eligible volume and your eligible user count × 5 MB/day. Use the “Size the Microsoft 365 E5 benefit” query in the cost controls to measure it, then enter the result under “M365 E5 (GB/day)”.",
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
  const commitment = cost.commitment;
  const paygOption = commitment?.options.find((o) => o.tierGbPerDay == null);
  const recommendedOption = commitment?.options.find((o) => o.recommended);
  const selectedOption = commitment?.options.find((o) => o.selected);
  if (monthlyGb >= 100 * rates.daysPerMonth && paygOption && recommendedOption) {
    const savings = round(recommendedOption.estimatedMonthlySavingsVsPayg);
    if ((input.commitmentTierMode ?? "off") === "off" && savings > 0) {
      recs.push({
        id: "commitment",
        severity: "high",
        title: "Move to a Sentinel Commitment Tier",
        detail:
          `Auto-modeling recommends ${recommendedOption.label} for this workload. Commitment pricing discounts Analytics ingestion vs PAYG; this estimate uses your current region rates and sustained volume to right-size just below daily usage.`,
        monthlySavings: savings,
      });
    } else if (selectedOption && selectedOption.tierGbPerDay != null && savings > 0) {
      recs.push({
        id: "commitment-selected",
        severity: "med",
        title: `Commitment tier selected: ${selectedOption.label}`,
        detail:
          `Compared with PAYG, this tier is currently modeled to save ${selectedOption.estimatedMonthlySavingsVsPayg > 0 ? "about" : "up to"} ${Math.abs(selectedOption.estimatedMonthlySavingsVsPayg).toFixed(0)} USD per month. Review utilization and overage to keep this right-sized.`,
        monthlySavings: round(Math.max(0, selectedOption.estimatedMonthlySavingsVsPayg)),
      });
    }
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
      migrationExamples: optimizationMigrationExamples(),
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
