import { useState } from "react";
import type { SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import type { SentinelCostEstimate } from "@engine/pricing/sentinelPricing.js";
import { DEFAULT_SENTINEL_RATES } from "@engine/pricing/index.js";
import { gbPerDay, gb, money } from "../lib/format.js";

interface Props {
  input: SentinelCostInput;
  cost: SentinelCostEstimate;
  onChange: (patch: Partial<SentinelCostInput>) => void;
}

function rate(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
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

/**
 * KQL helper to size the Microsoft 365 E5/A5/F5/G5 benefit. The offer grants up
 * to 5 MB/user/day of free Sentinel ingestion across a fixed set of eligible
 * Microsoft data types, so the effective grant is min(eligible ingest,
 * E5 users × 5 MB). Run in Log Analytics, set e5Users, and paste FreeGBPerDay
 * into the "M365 E5 (GB/day)" field.
 * Offer + eligible data types: https://azure.microsoft.com/offers/sentinel-microsoft-365-offer/
 */
const M365_E5_QUERY = `// Microsoft 365 E5/A5/F5/G5 benefit — up to 5 MB/user/day of free Sentinel ingestion.
// Eligible Microsoft data types per the offer; grant = min(eligible ingest, users x 5 MB).
let lookback = 7d;
let e5Users = 0;  // <-- your assigned E5/A5/F5/G5 user count (see the license query below)
let eligible = dynamic([
  "SigninLogs","AuditLogs","AADNonInteractiveUserSignInLogs","AADServicePrincipalSignInLogs",
  "AADManagedIdentitySignInLogs","AADProvisioningLogs","ADFSSignInLogs","AADUserRiskEvents",
  "AADRiskyUsers","OfficeActivity","McasShadowItReporting","InformationProtectionLogs_CL",
  "DeviceEvents","DeviceFileEvents","DeviceImageLoadEvents","DeviceInfo","DeviceLogonEvents",
  "DeviceNetworkEvents","DeviceNetworkInfo","DeviceProcessEvents","DeviceRegistryEvents",
  "DeviceFileCertificateInfo","EmailEvents","EmailUrlInfo","EmailAttachmentInfo","EmailPostDeliveryEvents"]);
Usage
| where TimeGenerated > ago(lookback) and IsBillable == true
| where DataType in (eligible)
| summarize GB = sum(Quantity) / 1024.0 by bin(TimeGenerated, 1d)
| summarize EligibleGBPerDay = round(avg(GB), 3)
| extend CapGBPerDay = round(e5Users * 5.0 / 1024.0, 3)
| extend FreeGBPerDay = iff(e5Users > 0, min_of(EligibleGBPerDay, CapGBPerDay), EligibleGBPerDay)`;

/**
 * Microsoft Graph (PowerShell) helper to count assigned E5/A5/F5/G5 licenses,
 * which sets the 5 MB/user/day cap above. Licenses live in Entra ID, not in
 * Log Analytics, so this runs separately from the KQL helpers.
 */
const M365_E5_LICENSE_QUERY = `# Count users with an eligible Microsoft 365 E5/A5/F5/G5 license assigned.
# Microsoft Graph PowerShell — needs delegated User.Read.All + Organization.Read.All.
Connect-MgGraph -Scopes "User.Read.All","Organization.Read.All"
# Eligible SKU part numbers — adjust to match your tenant's plans:
$eligible = @("SPE_E5","ENTERPRISEPREMIUM","SPE_F5_SECCOMP","M365_F5_SECURITY",
  "M365EDU_A5_FACULTY","M365EDU_A5_STUUSEBNFT","Microsoft_365_G5")
$skuIds = (Get-MgSubscribedSku | Where-Object { $_.SkuPartNumber -in $eligible }).SkuId
(Get-MgUser -All -Property assignedLicenses |
  Where-Object { $_.AssignedLicenses.SkuId | Where-Object { $_ -in $skuIds } } |
  Measure-Object).Count`;

/**
 * KQL helper to measure always-free Microsoft Sentinel data sources, so the
 * volume can be excluded from billable estimates. Free sources per
 * https://learn.microsoft.com/azure/sentinel/billing#free-data-sources
 */
const FREE_SOURCES_QUERY = `// Always-free Microsoft Sentinel data sources (not charged for ingestion).
// Azure Activity, Sentinel Health, Office 365 audit, and security alerts/incidents.
let lookback = 7d;
let freeTypes = dynamic([
  "AzureActivity","SentinelHealth","OfficeActivity","SecurityAlert","SecurityIncident"]);
Usage
| where TimeGenerated > ago(lookback)
| where DataType in (freeTypes)
| summarize GB = sum(Quantity) / 1024.0 by bin(TimeGenerated, 1d)
| summarize FreeGBPerDay = round(avg(GB), 3)`;

export default function CostControls({ input, cost, onChange }: Props) {
  const b = input.benefits ?? {};
  const perTable = input.tableRetention != null;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  function setBenefit(patch: Partial<NonNullable<SentinelCostInput["benefits"]>>) {
    onChange({ benefits: { ...b, ...patch } });
  }
  async function copyQuery(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    } catch {
      /* clipboard unavailable — user can select the query text manually */
    }
  }

  const commitmentMode = input.commitmentTierMode ?? "off";
  const commitmentTiers = DEFAULT_SENTINEL_RATES.commitmentTiers;
  const dataLakeGbDay = Math.max(0, input.dataLakeGbPerDay ?? 0);
  const dataLakeMonthlyGb = dataLakeGbDay * cost.rates.daysPerMonth;
  const analyticsMonthlyGb = Math.max(0, input.analyticsGbPerDay) * cost.rates.daysPerMonth;

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="analytics-ingest-derived">Analytics ingestion (from your data)</label>
        <input id="analytics-ingest-derived" type="text" readOnly value={gbPerDay(input.analyticsGbPerDay)} />
        <p className="ai-note">Derived from the parsed/estimated sources above.</p>
      </div>

      <div className="field-row">
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

      <div className="section-head">
        <span className="eyebrow">Data Lake / Auxiliary pricing</span>
      </div>
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
        <p className="ai-note">
          Use this for lower-cost, lower-query-frequency logs that you do not need in full Analytics.
        </p>
      </div>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">Backend ingestion pricing used by lane</caption>
          <thead>
            <tr>
              <th>Lane</th>
              <th className="num">Input GB/day</th>
              <th className="num">Rate/GB</th>
              <th className="num">Est. ingest/mo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Analytics</td>
              <td className="num">{gbPerDay(Math.max(0, input.analyticsGbPerDay))}</td>
              <td className="num">{rate(cost.rates.analyticsIngestPerGb)}</td>
              <td className="num">{money(cost.breakdown.analyticsIngestion)}</td>
            </tr>
            <tr>
              <td>Data Lake / Auxiliary</td>
              <td className="num">{gbPerDay(dataLakeGbDay)}</td>
              <td className="num">{rate(cost.rates.dataLakeIngestPerGb)}</td>
              <td className="num">{money(cost.breakdown.dataLakeIngestion)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ai-note">
        Backend pricing shown from the active regional rate card and current model inputs.
        Source reference: {" "}
        <a
          href="https://www.microsoft.com.office.prod.abbvie.myshn.net/en-us/security/pricing/microsoft-sentinel#section-master-oc2d43"
          target="_blank"
          rel="noopener noreferrer"
        >
          Microsoft Sentinel pricing
        </a>
        . Current modeled monthly ingestion volume: {gb(analyticsMonthlyGb)} Analytics and {gb(dataLakeMonthlyGb)} Data Lake.
      </p>

      <div className="section-head">
        <span className="eyebrow">Commitment tier modeling</span>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="commitment-mode">Analytics pricing mode</label>
          <select
            id="commitment-mode"
            value={commitmentMode}
            onChange={(e) =>
              onChange({
                commitmentTierMode: e.target.value as SentinelCostInput["commitmentTierMode"],
              })
            }
          >
            <option value="off">PAYG (no commitment)</option>
            <option value="auto">Auto-select commitment tier</option>
            <option value="manual">Manual commitment tier</option>
          </select>
          <p className="ai-note">
            Auto chooses the largest tier at or below your sustained billable daily volume.
          </p>
        </div>
        {commitmentMode === "manual" && (
          <div className="field">
            <label htmlFor="commitment-tier">Commitment tier (GB/day)</label>
            <select
              id="commitment-tier"
              value={input.commitmentTierGbPerDay ?? ""}
              onChange={(e) =>
                onChange({
                  commitmentTierGbPerDay: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            >
              <option value="">Select a tier</option>
              {commitmentTiers.map((tier) => (
                <option key={tier.gbPerDay} value={tier.gbPerDay}>
                  {tier.label ?? `${tier.gbPerDay} GB/day`} ({Math.round(tier.discountPct * 100)}% discount)
                </option>
              ))}
            </select>
          </div>
        )}
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
      <p className="ai-note">
        These grants reduce your billable Analytics volume. Enter a GB/day figure directly, or use
        the matching query below to measure it in your own environment and paste the result.
      </p>
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
        <summary>Size the Microsoft 365 E5 benefit</summary>
        <p className="ai-note">
          The Microsoft Sentinel benefit for Microsoft 365 E5/A5/F5/G5 customers grants up to
          5 MB/user/day of free Sentinel ingestion across a fixed set of eligible Microsoft data
          types (Microsoft Entra ID logs, Microsoft 365/Office activity, Defender XDR &amp; Defender
          for Endpoint raw data, Defender for Cloud Apps Shadow IT, and Information Protection). The
          effective grant is the smaller of that eligible volume and your eligible user count ×
          5 MB. Enter the GB/day above, or run this query and paste its <code>FreeGBPerDay</code>{" "}
          result.
        </p>
        <div className="query-head">
          <span className="query-lang">KQL</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => copyQuery("e5", M365_E5_QUERY)}
          >
            {copiedId === "e5" ? "Copied ✓" : "Copy query"}
          </button>
        </div>
        <pre className="code-block" aria-label="Microsoft 365 E5 benefit query">
          <code>{M365_E5_QUERY}</code>
        </pre>
        <p className="ai-note">
          Don't know your eligible user count? Run this Microsoft Graph (PowerShell) query to total
          the assigned E5/A5/F5/G5 licenses, then set <code>e5Users</code> above.
        </p>
        <div className="query-head">
          <span className="query-lang">PowerShell</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => copyQuery("e5lic", M365_E5_LICENSE_QUERY)}
          >
            {copiedId === "e5lic" ? "Copied ✓" : "Copy query"}
          </button>
        </div>
        <pre className="code-block" aria-label="Microsoft 365 E5 license-count query">
          <code>{M365_E5_LICENSE_QUERY}</code>
        </pre>
        <p className="ai-note">
          Offer terms and eligible data types per Microsoft's{" "}
          <a
            href="https://azure.microsoft.com/offers/sentinel-microsoft-365-offer/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Microsoft Sentinel benefit for Microsoft 365 E5 customers
          </a>
          .
        </p>
      </details>

      <details className="mt-sm">
        <summary>Size the Defender for Servers Plan 2 benefit</summary>
        <p className="ai-note">
          Defender for Servers Plan 2 grants 500 MB/node/day of free ingestion into eligible
          security tables, pooled across the subscription. Enter the GB/day directly above, or run
          this query in Log Analytics and paste its <code>FreeGBPerDay</code> result.
        </p>
        <div className="query-head">
          <span className="query-lang">KQL</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => copyQuery("def", DEFENDER_P2_QUERY)}
          >
            {copiedId === "def" ? "Copied ✓" : "Copy query"}
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

      <details className="mt-sm">
        <summary>Measure always-free data sources</summary>
        <p className="ai-note">
          Some sources are never charged for ingestion — Azure Activity, Microsoft Sentinel Health,
          Office 365 audit logs, and security alerts/incidents. Run this query to total their volume
          so you can exclude it, then enter the result above. (Raw Defender/Entra logs are still
          paid — only the alerts and listed types are free.)
        </p>
        <div className="query-head">
          <span className="query-lang">KQL</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => copyQuery("free", FREE_SOURCES_QUERY)}
          >
            {copiedId === "free" ? "Copied ✓" : "Copy query"}
          </button>
        </div>
        <pre className="code-block" aria-label="Always-free data sources query">
          <code>{FREE_SOURCES_QUERY}</code>
        </pre>
        <p className="ai-note">
          Free data sources per Microsoft's{" "}
          <a
            href="https://learn.microsoft.com/azure/sentinel/billing#free-data-sources"
            target="_blank"
            rel="noopener noreferrer"
          >
            Sentinel billing
          </a>{" "}
          documentation.
        </p>
      </details>
    </div>
  );
}
