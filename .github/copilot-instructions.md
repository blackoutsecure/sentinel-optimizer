# Copilot instructions — sentinel-optimizer

Sentinel Optimizer is a **zero-trust, client-side** SIEM cost & migration estimator.
The longer-term vision is a **Universal SIEM Collector**: take usage data from any
SIEM, normalize it to one schema, and estimate Microsoft Sentinel cost + give
optimization/migration recommendations. Keep changes aligned with the rules below.

## Architecture

- **Engine (repo root, TypeScript):** `parsers/`, `schema/`, `pricing/`,
  `src/lib/` (recommendations, format, aiClient). Pure, dependency-light,
  unit-tested with Vitest. No network calls, no secrets.
- **Web app (`web/`):** Astro + React islands. The estimator UI lives in
  `web/src/components/` (`Optimizer.tsx` orchestrates `DataInput`,
  `Recommendations`, `ExportBar`, the inventory wizard, and charts).
- **AI (optional):** same-origin Cloudflare Pages Functions in `web/functions/api/`
  (`recommend.ts`, `example.ts`). They use Workers AI bindings only. If the `AI`
  binding is absent they return **501** and the UI falls back gracefully.

## Non-negotiable principles

1. **Zero trust / privacy-first.** Everything parses in the browser. Never add a
   backend that receives raw logs or credentials. AI endpoints may receive only
   **aggregated, non-identifying** summaries (totals, source names, byte counts) —
   never raw events, never secrets.
2. **No credentials in the product.** The user runs queries/exports/curl on their
   own systems and pastes the result. We never store or transmit keys/tokens.
3. **Graceful degradation.** AI is always optional. Static examples and local
   estimation must work with no AI binding.
4. **Unofficial / estimate framing.** All cost output and exports must keep the
   "unofficial estimate, not affiliated with Microsoft" disclaimer.

## Data ingestion priority (per vendor)

Offer the least-privilege method first; fall back down the list:

1. **Native query** — copyable read-only query (KQL/SPL/AQL/LEQL/etc.) the user
   runs in their SIEM, then pastes the JSON result.
2. **Export / paste** — paste or upload a CSV/JSON usage export.
3. **REST API via curl** — a copyable curl command with placeholder tokens the
   user fills in and runs locally, then pastes the JSON. (Roadmap.)
4. **Script fallback** — a downloadable read-only script as a last resort. (Roadmap.)

Required permissions must always be **read-only / least privilege** (e.g. Sentinel:
Reader + Log Analytics Reader, optional Security Reader).

## Normalized schema

All parsers emit the shape in `schema/normalization.ts` (`NormalizedResult`:
`vendor`, `sources[]`, totals, optional connectors/DCRs). Add new vendors by:

1. Adding the id to the `Vendor` union in `schema/normalization.ts` **and** the
   web `Vendor` union in `web/src/lib/examples.ts`.
2. Adding a `VendorMeta` entry in `web/src/lib/examples.ts` (label, `parser`,
   `queryLang`, `query`, `hint`, `example`, optional `avgEventBytes` for
   EPS/message-rate platforms).
3. Routing through an existing parser. Use `parser: "generic"` for `{ name, bytes }`
   or `{ name, events }` rows; only add a dedicated parser for genuinely unique
   vendor formats. The generic parser converts events→bytes via `avgEventBytes`
   and GB fields→bytes.

Vendors currently surfaced: Sentinel, Splunk, Elastic, Rapid7, QRadar, Sumo Logic,
CrowdStrike LogScale, Chronicle (Google SecOps), Datadog, Exabeam, LogRhythm,
Arctic Wolf.

## Code & UX conventions

- TypeScript strict; prefer pure functions and explicit types over `any`.
- Keep engine logic framework-free so it stays unit-testable.
- React: small islands, local state, no global stores. Reset state cleanly on
  vendor change and on "Start over".
- Money/units go through `src/lib/format.ts` helpers (`money`, `gb`, `gbPerDay`).
- Brand palette lives in `web/src/lib/exporters.ts` (`BRAND`); reuse it for any
  new visual/export surface.

## Testing & validation

- Engine: `CI=true npx vitest run --reporter=dot` from the repo root.
- Web build: `cd web && npm run build` (expect exit 0). Two pre-existing lint
  notes — `aria-selected` dynamic expression on the segmented tabs and one inline
  style in `Recommendations.tsx` — are known and **not** regressions.
- Add/extend Vitest coverage when you add a parser or a recommendation rule.

## Promotion / release

The live site builds from this repo's `main`. Promote via fast-forward merge:
`git push origin dev && git checkout main && git merge --ff-only dev &&
git push origin main && git checkout dev`. There is no CI promotion workflow.
