# sentinel-optimizer

**Universal SIEM Collector** — a zero-trust, client-side engine that parses log
volume, connector metadata, and configuration exports from multiple SIEM
vendors and normalizes them into a single schema for cost modeling, migration
estimation, and optimization.

> Everything runs locally. The engine only parses JSON you provide — no
> credentials, no uploads, no external calls.

## Trust model

- **No credentials.** Never asks for tokens, keys, or secrets.
- **Client-side only.** Parsing is pure and deterministic; nothing is stored or
  transmitted.
- **You run the queries.** Paste exported JSON from your own SIEM; the engine
  never connects to it.

## Supported vendors

Parsers implemented: **Sentinel**, **Splunk**, **Elastic**. The normalized
schema is vendor-agnostic and designed to extend to additional SIEMs.

## Project layout

| Path | Purpose |
|------|---------|
| `schema/normalization.ts` | Canonical normalized schema + pure helpers |
| `parsers/<vendor>.ts` | Vendor-specific parsers (pure, deterministic) |
| `parsers/index.ts` | Parser registry |
| `estimators/dataVolumeEstimator.ts` | Inventory-based GB/day estimator + source catalog |
| `estimators/index.ts` | Estimator registry |
| `pricing/sentinelPricing.ts` | Sentinel monthly cost model + public rate card |
| `pricing/index.ts` | Pricing registry |
| `samples/<vendor>.json` | Sample query/export output used by tests |
| `test/` | Unit tests (Vitest) |

## Normalized schema

Every parser returns the same shape:

```ts
{
  vendor: string,
  sources: [
    { name: string, events?: number, bytes?: number, gbPerDay?: number, storage?: string }
  ],
  connectors?: [...],
  dcrs?: [...],
  totals?: { gbPerDay?: number, events?: number, bytes?: number }
}
```

## Usage

```ts
import { parseSentinel } from "./parsers/index.js";

// `usage` is the JSON output of a KQL Usage query you ran in your tenant.
const result = parseSentinel({ usage, windowDays: 30 });
console.log(result.totals?.gbPerDay);
```

### Example: Microsoft Sentinel (KQL)

Run this in Log Analytics, then paste the JSON result:

```kql
Usage
| where TimeGenerated > ago(30d)
| summarize QuantityMB = sum(Quantity) by DataType
```

### Example: Splunk (SPL)

```spl
index=_internal source=*license_usage.log type=Usage
| stats sum(b) as bytes by idx
```

### Example: Elasticsearch

```
GET _cat/indices?format=json&bytes=b
```

## Data Volume Estimator

When no logs are available yet, estimate Sentinel ingestion volume from an
infrastructure inventory — node/endpoint/user counts per data-source type. No
logs, credentials, or live environment are touched; it is a pure calculation.

```ts
import { estimateDataVolume } from "./estimators/index.js";

const result = estimateDataVolume({
  rows: [
    { name: "Windows Servers w/ medium EPS", count: 200 },
    { name: "Network Firewalls (DMZ)", count: 4 },
  ],
});
console.log(result.totals?.gbPerDay);
```

Each source type carries a default average event size and events-per-second
(see `DATA_SOURCE_CATALOG`), both overridable per row. Volume is computed with:

```
GB/day = (avgEventSizeBytes × (count × avgEpsPerNode) × 86400) / 1024³
```

The estimator output uses the same normalized schema as the vendor parsers, so
it feeds directly into cost modeling and optimization.

## Cost model

Turn normalized ingestion volume into an estimated monthly Sentinel cost. Rates
default to Microsoft Sentinel's public, per-GB list pricing (USD) and are fully
overridable for region, currency, or negotiated tiers.

```ts
import { estimateMonthlyCost } from "./pricing/index.js";

const cost = estimateMonthlyCost({
  analyticsGbPerDay: 500,
  dataLakeGbPerDay: 2000,
  searchTbPerMonth: 500,
  benefits: { m365E5FreeGbPerDay: 50, defenderP2FreeGbPerDay: 30 },
});
console.log(cost.monthlyCost, cost.breakdown);
```

The model covers Analytics and Data Lake ingestion, interactive retention (with
the free window), long-term storage, data search, SOAR, Security Copilot, and
Sentinel for SAP. It also accounts for free-ingestion benefits (Microsoft 365
E5, Defender for Servers P2, always-free sources) and an optional weekend
ingestion-optimization discount. Pass a `NormalizedResult` directly with
`estimateMonthlyCostFromResult(result, options)`.

All rates live in `DEFAULT_SENTINEL_RATES`; nothing is hard-coded to a customer
or contract.

## Development

```bash
npm install
npm test          # run the Vitest suite
npm run typecheck # tsc --noEmit
```

Parsers are pure and deterministic, and each vendor has a sample fixture in
`samples/` plus a unit test in `test/`.

## Branch hardening (dev and production)

- `dev` is the integration branch for active changes.
- `main` is the production/stable branch.

To keep both paths shored up, this repo includes:

- CI on both branches and their PRs: `.github/workflows/ci-dev-main.yml`
  - Root engine: `npm ci`, `npm run typecheck`, `npm test`
  - Web app: `web npm ci`, `npm run typecheck`, `npm run build`
- Promotion safety gate: `.github/workflows/promotion-gate.yml`
  - Validates that `main` is an ancestor of `dev` (fast-forwardable promotion path)
  - Prevents unnoticed branch divergence before release promotion

Recommended release flow:

1. Merge feature work into `dev` only.
2. Keep `dev` green via CI.
3. Promote `dev` to `main` with a PR once the promotion gate passes.
