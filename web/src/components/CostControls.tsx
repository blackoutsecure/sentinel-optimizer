import { useState } from "react";
import type { SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import { gbPerDay } from "../lib/format.js";

interface Props {
  input: SentinelCostInput;
  onChange: (patch: Partial<SentinelCostInput>) => void;
}

function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * KQL helper to size the Defender for Servers Plan 2 free-ingestion benefit.
 * The benefit is 500 MB/node/day, pooled per subscription and applied to a
 * fixed set of eligible security tables, so the effective grant is
 * min(eligible ingest, nodes × 500 MB). Run in Log Analytics and paste the
 * resulting FreeGBPerDay into the "Defender Servers P2 (GB/day)" field.
 * Eligible tables per https://learn.microsoft.com/azure/defender-for-cloud/data-ingestion-benefit
 */
const DEFENDER_P2_QUERY = `// Defender for Servers Plan 2 — free data-ingestion benefit (500 MB/node/day).
// Pooled per subscription: effective grant = min(eligible ingest, nodes x 500 MB).
let lookback = 7d;
let eligible = dynamic([
  "SecurityAlert","SecurityBaseline","SecurityBaselineSummary","SecurityDetection",
  "SecurityEvent","WindowsFirewall","ProtectionStatus","Update","UpdateSummary",
  "MDCFileIntegrityMonitoringEvents","WindowsEvent"]);
let nodes = toscalar(
    Heartbeat
    | where TimeGenerated > ago(lookback)
    | summarize dcount(Computer));
Usage
| where TimeGenerated > ago(lookback) and IsBillable == true
| where DataType in (eligible)
| summarize GB = sum(Quantity) / 1024.0 by bin(TimeGenerated, 1d)
| summarize EligibleGBPerDay = round(avg(GB), 3)
| extend Nodes = nodes, CapGBPerDay = round(nodes * 500.0 / 1024.0, 3)
| extend FreeGBPerDay = min_of(EligibleGBPerDay, CapGBPerDay)`;

export default function CostControls({ input, onChange }: Props) {
  const b = input.benefits ?? {};
  const perTable = input.tableRetention != null;
  const [copied, setCopied] = useState(false);
  function setBenefit(patch: Partial<NonNullable<SentinelCostInput["benefits"]>>) {
    onChange({ benefits: { ...b, ...patch } });
  }
  async function copyDefenderQuery() {
    try {
      await navigator.clipboard.writeText(DEFENDER_P2_QUERY);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — user can select the query text manually */
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <label>Analytics ingestion (from your data)</label>
        <input type="text" readOnly value={gbPerDay(input.analyticsGbPerDay)} />
        <p className="ai-note">Derived from the parsed/estimated sources above.</p>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="lake">Data Lake / Auxiliary (GB/day)</label>
          <input
            id="lake"
            type="number"
            min={0}
            value={input.dataLakeGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ dataLakeGbPerDay: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="opt">Ingestion optimization (%)</label>
          <input
            id="opt"
            type="number"
            min={0}
            max={90}
            value={input.ingestionOptimizationPct != null ? input.ingestionOptimizationPct * 100 : ""}
            placeholder="0"
            onChange={(e) => {
              const n = num(e.target.value);
              onChange({ ingestionOptimizationPct: n != null ? n / 100 : undefined });
            }}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="iret">Interactive retention (months)</label>
          <input
            id="iret"
            type="number"
            min={0}
            disabled={perTable}
            value={input.interactiveRetentionMonths ?? ""}
            placeholder="3 (free)"
            onChange={(e) => onChange({ interactiveRetentionMonths: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="store">Long-term storage (months)</label>
          <input
            id="store"
            type="number"
            min={0}
            disabled={perTable}
            value={input.dataStorageMonths ?? ""}
            placeholder="12"
            onChange={(e) => onChange({ dataStorageMonths: num(e.target.value) })}
          />
        </div>
      </div>
      {perTable && (
        <p className="ai-note">Retention is managed per table below — these two are overridden.</p>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="search">Search (TB/month)</label>
          <input
            id="search"
            type="number"
            min={0}
            value={input.searchTbPerMonth ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ searchTbPerMonth: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="soar">SOAR actions / month</label>
          <input
            id="soar"
            type="number"
            min={0}
            value={input.soarActionsPerMonth ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ soarActionsPerMonth: num(e.target.value) })}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="scu">Security Copilot (SCUs)</label>
          <input
            id="scu"
            type="number"
            min={0}
            value={input.securityCopilotScu ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ securityCopilotScu: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="sap">Sentinel for SAP (SIDs)</label>
          <input
            id="sap"
            type="number"
            min={0}
            value={input.sapProductionSids ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ sapProductionSids: num(e.target.value) })}
          />
        </div>
      </div>

      <div className="section-head">
        <span className="eyebrow">Free-ingestion benefits</span>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="e5">M365 E5 (GB/day)</label>
          <input
            id="e5"
            type="number"
            min={0}
            value={b.m365E5FreeGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => setBenefit({ m365E5FreeGbPerDay: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="def">Defender Servers P2 (GB/day)</label>
          <input
            id="def"
            type="number"
            min={0}
            value={b.defenderP2FreeGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => setBenefit({ defenderP2FreeGbPerDay: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="freesrc">Always-free sources (GB/day)</label>
          <input
            id="freesrc"
            type="number"
            min={0}
            value={b.freeDataSourceGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => setBenefit({ freeDataSourceGbPerDay: num(e.target.value) })}
          />
        </div>
      </div>

      <details className="mt-sm">
        <summary>Size the Defender for Servers Plan 2 benefit</summary>
        <p className="ai-note">
          Defender for Servers Plan 2 grants 500 MB/node/day of free ingestion into eligible
          security tables, pooled across the subscription. Enter the GB/day directly above, or run
          this query in Log Analytics and paste its <code>FreeGBPerDay</code> result.
        </p>
        <div className="query-head">
          <span className="query-lang">KQL</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copyDefenderQuery}>
            {copied ? "Copied ✓" : "Copy query"}
          </button>
        </div>
        <pre className="code-block" aria-label="Defender for Servers P2 benefit query">
          <code>{DEFENDER_P2_QUERY}</code>
        </pre>
        <p className="ai-note">
          Eligible tables and the 500 MB/node/day rule per Microsoft's{" "}
          <a
            href="https://learn.microsoft.com/azure/defender-for-cloud/data-ingestion-benefit"
            target="_blank"
            rel="noopener noreferrer"
          >
            data ingestion benefit
          </a>{" "}
          documentation.
        </p>
      </details>
    </div>
  );
}
