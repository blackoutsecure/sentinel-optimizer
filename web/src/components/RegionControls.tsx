import { useMemo, useState } from "react";
import type {
  SentinelCostInput,
  SentinelCostEstimate,
} from "@engine/pricing/sentinelPricing.js";
import { estimateMonthlyCost } from "@engine/pricing/sentinelPricing.js";
import {
  SENTINEL_REGIONS,
  DEFAULT_REGION_ID,
  regionById,
  type SentinelRegion,
} from "@engine/pricing/regions.js";
import { money } from "../lib/format.js";

interface Props {
  input: SentinelCostInput;
  cost: SentinelCostEstimate;
  onChange: (patch: Partial<SentinelCostInput>) => void;
}

/** Per-GB / per-unit rate formatter with enough precision for tiny rates. */
function rate(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

/** Group regions by geography for an organized <optgroup> picker. */
function byGeo(): { geo: string; regions: SentinelRegion[] }[] {
  const groups = new Map<string, SentinelRegion[]>();
  for (const r of SENTINEL_REGIONS) {
    const list = groups.get(r.geo) ?? [];
    list.push(r);
    groups.set(r.geo, list);
  }
  return [...groups.entries()].map(([geo, regions]) => ({ geo, regions }));
}

export default function RegionControls({ input, cost, onChange }: Props) {
  const [showRates, setShowRates] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  const selectedId = input.regionId ?? DEFAULT_REGION_ID;
  const groups = useMemo(byGeo, []);

  // Estimate the full monthly cost in every region for the current config.
  const ranked = useMemo(() => {
    return SENTINEL_REGIONS.map((r) => {
      const est = estimateMonthlyCost({ ...input, regionId: r.id });
      return { region: r, monthly: est.monthlyCost };
    }).sort((a, b) => a.monthly - b.monthly);
  }, [input]);

  const selectedMonthly =
    ranked.find((x) => x.region.id === selectedId)?.monthly ?? cost.monthlyCost;
  const cheapest = ranked[0];
  const savings = selectedMonthly - (cheapest?.monthly ?? selectedMonthly);
  const isCheapest = !cheapest || cheapest.region.id === selectedId;

  const r = cost.rates;

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="region">Datacenter location (Sentinel workspace region)</label>
        <select
          id="region"
          value={selectedId}
          onChange={(e) => onChange({ regionId: e.target.value })}
        >
          {groups.map((g) => (
            <optgroup key={g.geo} label={g.geo}>
              {g.regions.map((reg) => (
                <option key={reg.id} value={reg.id}>
                  {reg.label} — {rate(reg.analyticsIngestPerGb)}/GB
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="ai-note">
          You can run multiple Sentinel workspaces across regions (data residency, sovereignty,
          RBAC). Pricing is per workspace region — pick the location to price here.
        </p>
      </div>

      <div className="region-best">
        {isCheapest ? (
          <span className="muted">
            ✓ {regionById(selectedId)?.label ?? selectedId} is the lowest-priced region for this
            workload.
          </span>
        ) : (
          <>
            <span>
              Best price: <strong>{cheapest.region.label}</strong> at{" "}
              <strong>{money(cheapest.monthly)}/mo</strong> — save{" "}
              <span className="save-pill">{money(savings)}/mo</span> vs{" "}
              {regionById(selectedId)?.label ?? selectedId}.
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onChange({ regionId: cheapest.region.id })}
            >
              Use {cheapest.region.label}
            </button>
          </>
        )}
      </div>

      <details open={showRates} onToggle={(e) => setShowRates(e.currentTarget.open)}>
        <summary>Backend pricing used (region-adjusted)</summary>
        <div className="table-wrap mt-sm">
          <table>
            <caption className="sr-only">Resolved Sentinel rates for the selected region</caption>
            <tbody>
              <tr><td>Analytics ingestion</td><td className="num">{rate(r.analyticsIngestPerGb)}/GB</td></tr>
              <tr><td>Basic / Auxiliary ingestion</td><td className="num">{rate(r.basicIngestPerGb)}/GB</td></tr>
              <tr><td>Data Lake ingestion</td><td className="num">{rate(r.dataLakeIngestPerGb)}/GB</td></tr>
              <tr><td>Interactive retention</td><td className="num">{rate(r.interactiveRetentionPerGbMonth)}/GB·mo</td></tr>
              <tr><td>Long-term storage</td><td className="num">{rate(r.dataStoragePerGbMonth)}/GB·mo</td></tr>
              <tr><td>Search</td><td className="num">{rate(r.dataSearchPerTb)}/TB</td></tr>
              <tr><td>Free interactive window</td><td className="num">{r.freeInteractiveRetentionMonths * 30} days</td></tr>
            </tbody>
          </table>
        </div>
        <p className="ai-note">
          Estimated public list prices (USD). Confirm against the Azure Pricing Calculator.
        </p>
      </details>

      <details open={showCompare} onToggle={(e) => setShowCompare(e.currentTarget.open)}>
        <summary>Compare all regions for this workload</summary>
        <div className="table-wrap mt-sm">
          <table>
            <caption className="sr-only">Estimated monthly cost by region</caption>
            <thead>
              <tr>
                <th>Region</th>
                <th className="num">$/GB</th>
                <th className="num">Est. monthly</th>
                <th className="num">vs selected</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ region, monthly }) => {
                const delta = monthly - selectedMonthly;
                const selected = region.id === selectedId;
                return (
                  <tr key={region.id} className={selected ? "row-selected" : ""}>
                    <td>
                      {region.label}
                      {region.id === cheapest?.region.id ? " ★" : ""}
                      {selected ? " (selected)" : ""}
                    </td>
                    <td className="num">{rate(region.analyticsIngestPerGb)}</td>
                    <td className="num">{money(monthly)}</td>
                    <td className="num">{delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${money(delta)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
