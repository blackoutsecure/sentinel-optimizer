import { useEffect, useRef, useState } from "react";
import type { SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import type { SentinelCostEstimate } from "@engine/pricing/sentinelPricing.js";
import { DEFAULT_SENTINEL_RATES } from "@engine/pricing/index.js";
import { gbPerDay, gb, money } from "../lib/format.js";

interface Props {
  input: SentinelCostInput;
  cost: SentinelCostEstimate;
  onChange: (patch: Partial<SentinelCostInput>) => void;
  suggestedLaneProfile?: LaneProfile;
  autoPlacementSeed?: string;
}

interface DefenderInventoryRow {
  name: string;
  gbPerDay: number;
}

interface AlwaysFreeRow {
  name: string;
  gbPerDay: number;
}

interface M365SkuRow {
  label: string;
  users: number;
}

interface M365EligibleRow {
  name: string;
  gbPerDay: number;
}

interface IngestionLaneRow {
  name: string;
  lane: "analytics" | "basicAux" | "dataLake";
  gbPerDay: number;
}

type LanePlanningMode = "guided" | "advanced";
type LaneProfile = "detectionFirst" | "balanced" | "costFirst";

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

export default function CostControls({
  input,
  cost,
  onChange,
  suggestedLaneProfile = "costFirst",
  autoPlacementSeed = "default",
}: Props) {
  const b = input.benefits ?? {};
  const perTable = input.tableRetention != null;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [m365Mode, setM365Mode] = useState<"inventory" | "query">("inventory");
  const [defenderMode, setDefenderMode] = useState<"inventory" | "query">("inventory");
  const [alwaysFreeMode, setAlwaysFreeMode] = useState<"inventory" | "query">("inventory");
  const [lanePlanningMode, setLanePlanningMode] = useState<LanePlanningMode>("guided");
  const [laneProfile, setLaneProfile] = useState<LaneProfile>("costFirst");
  const [whatIfShiftToBasicPct, setWhatIfShiftToBasicPct] = useState<number>(20);
  const [whatIfShiftToLakePct, setWhatIfShiftToLakePct] = useState<number>(10);
  const [whatIfOptimizationPct, setWhatIfOptimizationPct] = useState<number>(10);
  const [m365CostPerUser, setM365CostPerUser] = useState<number>(0);
  const [m365SkuRows, setM365SkuRows] = useState<M365SkuRow[]>([
    { label: "Microsoft 365 E5 / A5", users: 0 },
    { label: "Microsoft 365 F5", users: 0 },
    { label: "Microsoft 365 G5", users: 0 },
  ]);
  const [m365EligibleRows, setM365EligibleRows] = useState<M365EligibleRow[]>([
    { name: "SigninLogs / AuditLogs", gbPerDay: 0 },
    { name: "OfficeActivity", gbPerDay: 0 },
    { name: "Defender XDR tables", gbPerDay: 0 },
  ]);
  const [defenderNodes, setDefenderNodes] = useState<number>(0);
  const [defenderCostPerNode, setDefenderCostPerNode] = useState<number>(0);
  const [defenderRows, setDefenderRows] = useState<DefenderInventoryRow[]>([
    { name: "Windows SecurityEvent", gbPerDay: 0 },
  ]);
  const [alwaysFreeRows, setAlwaysFreeRows] = useState<AlwaysFreeRow[]>([
    { name: "AzureActivity", gbPerDay: 0 },
    { name: "SentinelHealth", gbPerDay: 0 },
    { name: "OfficeActivity", gbPerDay: 0 },
    { name: "SecurityAlert", gbPerDay: 0 },
    { name: "SecurityIncident", gbPerDay: 0 },
  ]);
  const [ingestionRows, setIngestionRows] = useState<IngestionLaneRow[]>([
    { name: "High-fidelity detection logs", lane: "analytics", gbPerDay: 0 },
    { name: "Lower-fidelity searchable logs", lane: "basicAux", gbPerDay: 0 },
    { name: "Lower-cost long-retention logs", lane: "dataLake", gbPerDay: 0 },
  ]);
  const autoPlacementAppliedRef = useRef<string | null>(null);

  function setBenefit(patch: Partial<NonNullable<SentinelCostInput["benefits"]>>) {
    onChange({ benefits: { ...b, ...patch } });
  }

  function setDefenderRow(i: number, patch: Partial<DefenderInventoryRow>) {
    setDefenderRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function setIngestionRow(i: number, patch: Partial<IngestionLaneRow>) {
    setIngestionRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function setM365SkuRow(i: number, patch: Partial<M365SkuRow>) {
    setM365SkuRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function setM365EligibleRow(i: number, patch: Partial<M365EligibleRow>) {
    setM365EligibleRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function setAlwaysFreeRow(i: number, patch: Partial<AlwaysFreeRow>) {
    setAlwaysFreeRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addDefenderRow() {
    setDefenderRows((prev) => [...prev, { name: "", gbPerDay: 0 }]);
  }

  function addM365SkuRow() {
    setM365SkuRows((prev) => [...prev, { label: "", users: 0 }]);
  }

  function addM365EligibleRow() {
    setM365EligibleRows((prev) => [...prev, { name: "", gbPerDay: 0 }]);
  }

  function addAlwaysFreeRow() {
    setAlwaysFreeRows((prev) => [...prev, { name: "", gbPerDay: 0 }]);
  }

  function addIngestionRow() {
    setIngestionRows((prev) => [...prev, { name: "", lane: "analytics", gbPerDay: 0 }]);
  }

  function removeDefenderRow(i: number) {
    setDefenderRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function removeM365SkuRow(i: number) {
    setM365SkuRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function removeM365EligibleRow(i: number) {
    setM365EligibleRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function removeAlwaysFreeRow(i: number) {
    setAlwaysFreeRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function removeIngestionRow(i: number) {
    setIngestionRows((prev) => prev.filter((_, idx) => idx !== i));
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

  const commitmentMode = input.commitmentTierMode ?? "auto";
  const commitmentTiers = DEFAULT_SENTINEL_RATES.commitmentTiers;
  const ingestionAnalyticsGbPerDay = ingestionRows
    .filter((r) => r.lane === "analytics")
    .reduce((a, r) => a + Math.max(0, r.gbPerDay || 0), 0);
  const ingestionBasicAuxGbPerDay = ingestionRows
    .filter((r) => r.lane === "basicAux")
    .reduce((a, r) => a + Math.max(0, r.gbPerDay || 0), 0);
  const ingestionDataLakeGbPerDay = ingestionRows
    .filter((r) => r.lane === "dataLake")
    .reduce((a, r) => a + Math.max(0, r.gbPerDay || 0), 0);
  const dataLakeGbDay = Math.max(0, input.dataLakeGbPerDay ?? 0);
  const basicAuxGbDay = Math.max(0, input.basicAuxGbPerDay ?? 0);
  const dataLakeMonthlyGb = dataLakeGbDay * cost.rates.daysPerMonth;
  const basicAuxMonthlyGb = basicAuxGbDay * cost.rates.daysPerMonth;
  const analyticsMonthlyGb = Math.max(0, input.analyticsGbPerDay) * cost.rates.daysPerMonth;
  const m365QualifyingUsers = m365SkuRows.reduce((a, r) => a + Math.max(0, r.users || 0), 0);
  const m365EligibleGbPerDay = m365EligibleRows.reduce((a, r) => a + Math.max(0, r.gbPerDay || 0), 0);
  const m365CapGbPerDay = m365QualifyingUsers * 5.0 / 1024.0;
  const m365EstimatedFreeGbPerDay = Math.min(m365EligibleGbPerDay, m365CapGbPerDay);
  const m365EstimatedMonthlyValue = m365EstimatedFreeGbPerDay * cost.rates.daysPerMonth * cost.rates.analyticsIngestPerGb;
  const m365MonthlyLicenseCost = m365QualifyingUsers * Math.max(0, m365CostPerUser);
  const m365NetMonthlyValue = m365EstimatedMonthlyValue - m365MonthlyLicenseCost;
  const defenderEligibleGbPerDay = defenderRows.reduce((a, r) => a + Math.max(0, r.gbPerDay || 0), 0);
  const alwaysFreeTotalGbPerDay = alwaysFreeRows.reduce((a, r) => a + Math.max(0, r.gbPerDay || 0), 0);
  const defenderCapGbPerDay = Math.max(0, defenderNodes) * 500.0 / 1024.0;
  const defenderEstimatedFreeGbPerDay = Math.min(defenderEligibleGbPerDay, defenderCapGbPerDay);
  const defenderEstimatedMonthlyValue = defenderEstimatedFreeGbPerDay * cost.rates.daysPerMonth * cost.rates.analyticsIngestPerGb;
  const defenderMonthlyLicenseCost = Math.max(0, defenderNodes) * Math.max(0, defenderCostPerNode);
  const defenderNetMonthlyValue = defenderEstimatedMonthlyValue - defenderMonthlyLicenseCost;
  const totalPlannedIngestGbPerDay =
    Math.max(0, input.analyticsGbPerDay) +
    Math.max(0, input.basicAuxGbPerDay ?? 0) +
    Math.max(0, input.dataLakeGbPerDay ?? 0);

  function profileSplit(profile: LaneProfile): { analytics: number; basicAux: number; dataLake: number } {
    if (profile === "detectionFirst") {
      return { analytics: 0.8, basicAux: 0.15, dataLake: 0.05 };
    }
    if (profile === "costFirst") {
      return { analytics: 0.4, basicAux: 0.45, dataLake: 0.15 };
    }
    return { analytics: 0.6, basicAux: 0.3, dataLake: 0.1 };
  }

  function applyGuidedSplit(profile: LaneProfile) {
    const total = totalPlannedIngestGbPerDay;
    const split = profileSplit(profile);
    onChange({
      analyticsGbPerDay: Number((total * split.analytics).toFixed(3)),
      basicAuxGbPerDay: Number((total * split.basicAux).toFixed(3)),
      dataLakeGbPerDay: Number((total * split.dataLake).toFixed(3)),
    });
  }

  useEffect(() => {
    if (lanePlanningMode !== "guided") return;
    if (autoPlacementAppliedRef.current === autoPlacementSeed) return;
    const hasExistingAllocation =
      Math.max(0, input.basicAuxGbPerDay ?? 0) > 0 || Math.max(0, input.dataLakeGbPerDay ?? 0) > 0;
    if (hasExistingAllocation || Math.max(0, input.analyticsGbPerDay) <= 0) {
      autoPlacementAppliedRef.current = autoPlacementSeed;
      return;
    }
    setLaneProfile(suggestedLaneProfile);
    const split = profileSplit(suggestedLaneProfile);
    const total = Math.max(0, input.analyticsGbPerDay);
    onChange({
      analyticsGbPerDay: Number((total * split.analytics).toFixed(3)),
      basicAuxGbPerDay: Number((total * split.basicAux).toFixed(3)),
      dataLakeGbPerDay: Number((total * split.dataLake).toFixed(3)),
    });
    autoPlacementAppliedRef.current = autoPlacementSeed;
  }, [
    autoPlacementSeed,
    suggestedLaneProfile,
    lanePlanningMode,
    input.analyticsGbPerDay,
    input.basicAuxGbPerDay,
    input.dataLakeGbPerDay,
    onChange,
  ]);

  const baseAnalyticsGbPerDay = Math.max(0, input.analyticsGbPerDay);
  const baseBasicAuxGbPerDay = Math.max(0, input.basicAuxGbPerDay ?? 0);
  const baseDataLakeGbPerDay = Math.max(0, input.dataLakeGbPerDay ?? 0);
  const maxShiftPct = Math.min(100, whatIfShiftToBasicPct + whatIfShiftToLakePct);
  const shiftedFromAnalyticsGbPerDay = baseAnalyticsGbPerDay * (maxShiftPct / 100);
  const scenarioAnalyticsPreOpt = Math.max(0, baseAnalyticsGbPerDay - shiftedFromAnalyticsGbPerDay);
  const scenarioBasicAuxGbPerDay = baseBasicAuxGbPerDay + baseAnalyticsGbPerDay * (whatIfShiftToBasicPct / 100);
  const scenarioDataLakeGbPerDay = baseDataLakeGbPerDay + baseAnalyticsGbPerDay * (whatIfShiftToLakePct / 100);
  const scenarioAnalyticsGbPerDay = scenarioAnalyticsPreOpt * (1 - Math.max(0, Math.min(90, whatIfOptimizationPct)) / 100);
  const scenarioIngestMonthly =
    scenarioAnalyticsGbPerDay * cost.rates.daysPerMonth * cost.rates.analyticsIngestPerGb +
    scenarioBasicAuxGbPerDay * cost.rates.daysPerMonth * cost.rates.basicIngestPerGb +
    scenarioDataLakeGbPerDay * cost.rates.daysPerMonth * cost.rates.dataLakeIngestPerGb;
  const scenarioAnalyticsMonthlyGb = scenarioAnalyticsGbPerDay * cost.rates.daysPerMonth;
  const scenarioBasicAuxMonthlyGb = scenarioBasicAuxGbPerDay * cost.rates.daysPerMonth;
  const scenarioDataLakeMonthlyGb = scenarioDataLakeGbPerDay * cost.rates.daysPerMonth;
  const baseIngestMonthly =
    baseAnalyticsGbPerDay * cost.rates.daysPerMonth * cost.rates.analyticsIngestPerGb +
    baseBasicAuxGbPerDay * cost.rates.daysPerMonth * cost.rates.basicIngestPerGb +
    baseDataLakeGbPerDay * cost.rates.daysPerMonth * cost.rates.dataLakeIngestPerGb;
  const baseRetentionMonthly = cost.breakdown.interactiveRetention + cost.breakdown.dataStorage;
  const interactiveMonths = input.interactiveRetentionMonths ?? cost.rates.freeInteractiveRetentionMonths;
  const storageMonths = input.dataStorageMonths ?? 12;
  const paidInteractiveMonths = Math.max(0, interactiveMonths - cost.rates.freeInteractiveRetentionMonths);
  const scenarioInteractiveRetentionMonthly =
    perTable
      ? cost.breakdown.interactiveRetention
      : scenarioAnalyticsMonthlyGb * paidInteractiveMonths * cost.rates.interactiveRetentionPerGbMonth;
  const scenarioDataStorageMonthly =
    perTable
      ? cost.breakdown.dataStorage
      : (scenarioAnalyticsMonthlyGb + scenarioBasicAuxMonthlyGb + scenarioDataLakeMonthlyGb) *
        storageMonths *
        cost.rates.dataStoragePerGbMonth;
  const scenarioRetentionMonthly = scenarioInteractiveRetentionMonthly + scenarioDataStorageMonthly;
  const scenarioRetentionDelta = scenarioRetentionMonthly - baseRetentionMonthly;
  const baseScenarioModeMonthly = baseIngestMonthly + baseRetentionMonthly;
  const scenarioModeMonthly = scenarioIngestMonthly + scenarioRetentionMonthly;
  const scenarioTotalDelta = scenarioModeMonthly - baseScenarioModeMonthly;
  const analyticsDeltaGbPerDay = scenarioAnalyticsGbPerDay - baseAnalyticsGbPerDay;
  const basicAuxDeltaGbPerDay = scenarioBasicAuxGbPerDay - baseBasicAuxGbPerDay;
  const dataLakeDeltaGbPerDay = scenarioDataLakeGbPerDay - baseDataLakeGbPerDay;
  const scenarioMonthlyDelta = scenarioIngestMonthly - baseIngestMonthly;

  return (
    <div className="stack">
      <div className="section-head">
        <span className="eyebrow">Log Analytics (Analytics plan)</span>
      </div>
      <div className="field">
        <label htmlFor="analytics-ingest-derived">Analytics ingestion (GB/day)</label>
        <input id="analytics-ingest-derived" type="text" readOnly value={gbPerDay(input.analyticsGbPerDay)} />
        <p className="ai-note">
          Analytics is best for continuous detection and high-frequency querying.
        </p>
      </div>

      <div className="section-head">
        <span className="eyebrow">1) Placement recommendation model</span>
      </div>
      <p className="ai-note">
        For third-party SIEM migration, you often do not know final Sentinel table plans up front.
        Start with guided allocation, then switch to advanced/manual as your mapping matures.
      </p>
      <div className="segmented" role="tablist" aria-label="Data lane planning mode">
        <button
          type="button"
          role="tab"
          aria-selected={lanePlanningMode === "guided"}
          className={lanePlanningMode === "guided" ? "active" : ""}
          onClick={() => setLanePlanningMode("guided")}
        >
          Guided migration (unknown buckets)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={lanePlanningMode === "advanced"}
          className={lanePlanningMode === "advanced" ? "active" : ""}
          onClick={() => setLanePlanningMode("advanced")}
        >
          Advanced manual allocation
        </button>
      </div>

      {lanePlanningMode === "guided" ? (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="lane-profile">Migration allocation profile</label>
              <select
                id="lane-profile"
                value={laneProfile}
                onChange={(e) => setLaneProfile(e.target.value as LaneProfile)}
              >
                <option value="detectionFirst">Detection-first (more Analytics)</option>
                <option value="balanced">Balanced</option>
                <option value="costFirst">Cost-first (more Basic/Data Lake)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="planned-total">Current planned ingest total (GB/day)</label>
              <input id="planned-total" type="text" readOnly value={gbPerDay(totalPlannedIngestGbPerDay)} />
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => applyGuidedSplit(laneProfile)}>
              Apply guided allocation
            </button>
          </div>
          <p className="ai-note">
            This mode avoids forcing table-plan decisions too early. Refine with advanced mode later once
            DCR/table mappings are validated during migration.
          </p>
          <p className="ai-note">
            Suggested defaults by profile: detection-first (80/15/5), balanced (60/30/10),
            cost-first (40/45/15) for Analytics/Basic-Aux/Data Lake.
          </p>
        </>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data type / source</th>
                  <th>Plan type</th>
                  <th className="num">GB/day</th>
                  <th aria-label="Remove row" />
                </tr>
              </thead>
              <tbody>
                {ingestionRows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="text"
                        value={r.name}
                        placeholder="Table or source category"
                        onChange={(e) => setIngestionRow(i, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={r.lane}
                        onChange={(e) =>
                          setIngestionRow(i, { lane: e.target.value as IngestionLaneRow["lane"] })
                        }
                      >
                        <option value="analytics">Analytics</option>
                        <option value="basicAux">Basic / Auxiliary</option>
                        <option value="dataLake">Data Lake</option>
                      </select>
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        value={r.gbPerDay || ""}
                        placeholder="0"
                        onChange={(e) =>
                          setIngestionRow(i, { gbPerDay: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </td>
                    <td>
                      {ingestionRows.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeIngestionRow(i)}
                          aria-label="Remove ingestion row"
                        >
                          x
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={addIngestionRow}>
              Add lane row
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                onChange({
                  analyticsGbPerDay: Number(ingestionAnalyticsGbPerDay.toFixed(3)),
                  basicAuxGbPerDay: Number(ingestionBasicAuxGbPerDay.toFixed(3)),
                  dataLakeGbPerDay: Number(ingestionDataLakeGbPerDay.toFixed(3)),
                })
              }
            >
              Use calculated lane totals
            </button>
          </div>
        </>
      )}

      <div className="section-head">
        <span className="eyebrow">2) What-if pricing model</span>
      </div>
      <p className="ai-note">
        Test migration decisions before committing. Shift portions of current Analytics data into
        lower-cost lanes and apply an optimization assumption, then compare cost impact.
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="whatif-basic">Shift Analytics to Basic/Aux (%)</label>
          <input
            id="whatif-basic"
            type="number"
            min={0}
            max={100}
            value={whatIfShiftToBasicPct}
            onChange={(e) => setWhatIfShiftToBasicPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          />
        </div>
        <div className="field">
          <label htmlFor="whatif-lake">Shift Analytics to Data Lake (%)</label>
          <input
            id="whatif-lake"
            type="number"
            min={0}
            max={100}
            value={whatIfShiftToLakePct}
            onChange={(e) => setWhatIfShiftToLakePct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          />
        </div>
        <div className="field">
          <label htmlFor="whatif-opt">Optimization on remaining Analytics (%)</label>
          <input
            id="whatif-opt"
            type="number"
            min={0}
            max={90}
            value={whatIfOptimizationPct}
            onChange={(e) => setWhatIfOptimizationPct(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
          />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Baseline vs scenario</th>
              <th className="num">Baseline</th>
              <th className="num">Scenario</th>
              <th className="num">Delta</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Analytics lane (GB/day)</td>
              <td className="num">{gbPerDay(baseAnalyticsGbPerDay)}</td>
              <td className="num">{gbPerDay(scenarioAnalyticsGbPerDay)}</td>
              <td className="num">{analyticsDeltaGbPerDay === 0 ? "0.00 GB/day" : `${analyticsDeltaGbPerDay > 0 ? "+" : ""}${analyticsDeltaGbPerDay.toFixed(2)} GB/day`}</td>
            </tr>
            <tr>
              <td>Basic / Auxiliary lane (GB/day)</td>
              <td className="num">{gbPerDay(baseBasicAuxGbPerDay)}</td>
              <td className="num">{gbPerDay(scenarioBasicAuxGbPerDay)}</td>
              <td className="num">{basicAuxDeltaGbPerDay === 0 ? "0.00 GB/day" : `${basicAuxDeltaGbPerDay > 0 ? "+" : ""}${basicAuxDeltaGbPerDay.toFixed(2)} GB/day`}</td>
            </tr>
            <tr>
              <td>Data Lake lane (GB/day)</td>
              <td className="num">{gbPerDay(baseDataLakeGbPerDay)}</td>
              <td className="num">{gbPerDay(scenarioDataLakeGbPerDay)}</td>
              <td className="num">{dataLakeDeltaGbPerDay === 0 ? "0.00 GB/day" : `${dataLakeDeltaGbPerDay > 0 ? "+" : ""}${dataLakeDeltaGbPerDay.toFixed(2)} GB/day`}</td>
            </tr>
            <tr>
              <td>Ingestion cost/month</td>
              <td className="num">{money(baseIngestMonthly)}</td>
              <td className="num">{money(scenarioIngestMonthly)}</td>
              <td className="num">{scenarioMonthlyDelta === 0 ? "$0.00" : `${scenarioMonthlyDelta > 0 ? "+" : ""}${money(scenarioMonthlyDelta)}`}</td>
            </tr>
            <tr>
              <td>Retention cost/month</td>
              <td className="num">{money(baseRetentionMonthly)}</td>
              <td className="num">{money(scenarioRetentionMonthly)}</td>
              <td className="num">{scenarioRetentionDelta === 0 ? "$0.00" : `${scenarioRetentionDelta > 0 ? "+" : ""}${money(scenarioRetentionDelta)}`}</td>
            </tr>
            <tr>
              <td>Scenario total/month (ingest + retention)</td>
              <td className="num">{money(baseScenarioModeMonthly)}</td>
              <td className="num">{money(scenarioModeMonthly)}</td>
              <td className="num">{scenarioTotalDelta === 0 ? "$0.00" : `${scenarioTotalDelta > 0 ? "+" : ""}${money(scenarioTotalDelta)}`}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {perTable && (
        <p className="ai-note">
          Per-table retention is enabled, so scenario retention impact is held constant unless table retention or table-level lane plans are updated.
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() =>
            onChange({
              analyticsGbPerDay: Number(scenarioAnalyticsGbPerDay.toFixed(3)),
              basicAuxGbPerDay: Number(scenarioBasicAuxGbPerDay.toFixed(3)),
              dataLakeGbPerDay: Number(scenarioDataLakeGbPerDay.toFixed(3)),
              ingestionOptimizationPct: Math.max(0, Math.min(90, whatIfOptimizationPct)) / 100,
            })
          }
        >
          Apply what-if scenario
        </button>
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
        <span className="eyebrow">Basic / Auxiliary and Data Lake lanes</span>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="basicaux">Basic / Auxiliary (GB/day)</label>
          <input
            id="basicaux"
            type="number"
            min={0}
            value={input.basicAuxGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ basicAuxGbPerDay: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="lake">Data Lake (GB/day)</label>
          <input
            id="lake"
            type="number"
            min={0}
            value={input.dataLakeGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ dataLakeGbPerDay: num(e.target.value) })}
          />
        </div>
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
              <td>Basic / Auxiliary</td>
              <td className="num">{gbPerDay(basicAuxGbDay)}</td>
              <td className="num">{rate(cost.rates.basicIngestPerGb)}</td>
              <td className="num">{money(basicAuxMonthlyGb * cost.rates.basicIngestPerGb)}</td>
            </tr>
            <tr>
              <td>Data Lake</td>
              <td className="num">{gbPerDay(dataLakeGbDay)}</td>
              <td className="num">{rate(cost.rates.dataLakeIngestPerGb)}</td>
              <td className="num">{money(dataLakeMonthlyGb * cost.rates.dataLakeIngestPerGb)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ai-note">
        Backend pricing shown from the active regional rate card and current model inputs.
        Source reference: {" "}
        <a
          href="https://azure.microsoft.com/en-us/pricing/details/microsoft-sentinel/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Microsoft Sentinel pricing
        </a>
        . Current modeled monthly ingestion volume: {gb(analyticsMonthlyGb)} Analytics, {gb(basicAuxMonthlyGb)} Basic/Auxiliary, and {gb(dataLakeMonthlyGb)} Data Lake.
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
        These grants reduce your billable Analytics volume. Use each section below to estimate from
        inventory (detailed rows) or paste query totals.
      </p>

      <div className="section-head">
        <span className="eyebrow">Microsoft 365 qualifying-license benefit</span>
      </div>
      <p className="ai-note">
        This is broader than just E5: qualifying licenses include E5/A5/F5/G5 variants per
        Microsoft's offer terms. Benefit cap is 5 MB/user/day across qualifying users.
      </p>
      <div className="segmented" role="tablist" aria-label="M365 benefit sizing mode">
        <button
          type="button"
          role="tab"
          aria-selected={m365Mode === "inventory"}
          className={m365Mode === "inventory" ? "active" : ""}
          onClick={() => setM365Mode("inventory")}
        >
          Estimate from inventory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={m365Mode === "query"}
          className={m365Mode === "query" ? "active" : ""}
          onClick={() => setM365Mode("query")}
        >
          Enter query total
        </button>
      </div>

      {m365Mode === "inventory" ? (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="m365-cost-user">License cost per qualifying user/month (USD)</label>
              <input
                id="m365-cost-user"
                type="number"
                min={0}
                value={m365CostPerUser || ""}
                placeholder="0"
                onChange={(e) => setM365CostPerUser(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div className="field">
              <label htmlFor="m365-derived">Calculated free benefit (GB/day)</label>
              <input id="m365-derived" type="text" readOnly value={gbPerDay(m365EstimatedFreeGbPerDay)} />
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Qualifying license bucket</th>
                  <th className="num">Users</th>
                  <th aria-label="Remove row" />
                </tr>
              </thead>
              <tbody>
                {m365SkuRows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="text"
                        value={r.label}
                        placeholder="E5 / A5 / F5 / G5 variant"
                        onChange={(e) => setM365SkuRow(i, { label: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        value={r.users || ""}
                        placeholder="0"
                        onChange={(e) => setM365SkuRow(i, { users: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </td>
                    <td>
                      {m365SkuRows.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeM365SkuRow(i)}
                          aria-label="Remove license row"
                        >
                          x
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={addM365SkuRow}>
              Add license bucket
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Eligible M365-connected log / table</th>
                  <th className="num">GB/day</th>
                  <th aria-label="Remove row" />
                </tr>
              </thead>
              <tbody>
                {m365EligibleRows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="text"
                        value={r.name}
                        placeholder="SigninLogs / OfficeActivity / DeviceEvents"
                        onChange={(e) => setM365EligibleRow(i, { name: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        value={r.gbPerDay || ""}
                        placeholder="0"
                        onChange={(e) =>
                          setM365EligibleRow(i, { gbPerDay: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </td>
                    <td>
                      {m365EligibleRows.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeM365EligibleRow(i)}
                          aria-label="Remove eligible-log row"
                        >
                          x
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={addM365EligibleRow}>
              Add eligible log row
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setBenefit({ m365E5FreeGbPerDay: Number(m365EstimatedFreeGbPerDay.toFixed(3)) })}
            >
              Use calculated value
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>M365 benefit economics</th>
                  <th className="num">Monthly</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Qualifying users</td>
                  <td className="num">{m365QualifyingUsers.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Eligible ingest total (inventory)</td>
                  <td className="num">{gbPerDay(m365EligibleGbPerDay)}</td>
                </tr>
                <tr>
                  <td>Benefit cap (users x 5 MB/day)</td>
                  <td className="num">{gbPerDay(m365CapGbPerDay)}</td>
                </tr>
                <tr>
                  <td>Estimated benefit value (avoided Analytics ingest)</td>
                  <td className="num">{money(m365EstimatedMonthlyValue)}</td>
                </tr>
                <tr>
                  <td>Estimated qualifying-license cost</td>
                  <td className="num">{money(m365MonthlyLicenseCost)}</td>
                </tr>
                <tr>
                  <td>Net value</td>
                  <td className="num">{money(m365NetMonthlyValue)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="ai-note">
            Qualifier examples include E5/A5/F5/G5 families. Validate your exact SKUs against current
            Microsoft offer terms.
          </p>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="e5-query-total">M365 qualifying-license free benefit (GB/day)</label>
            <input
              id="e5-query-total"
              type="number"
              min={0}
              value={b.m365E5FreeGbPerDay ?? ""}
              placeholder="0"
              onChange={(e) => setBenefit({ m365E5FreeGbPerDay: num(e.target.value) })}
            />
          </div>
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
          <pre className="code-block" aria-label="Microsoft 365 benefit query">
            <code>{M365_E5_QUERY}</code>
          </pre>
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
          <pre className="code-block" aria-label="Microsoft 365 license-count query">
            <code>{M365_E5_LICENSE_QUERY}</code>
          </pre>
        </>
      )}

      <div className="section-head">
        <span className="eyebrow">Always-free data sources</span>
      </div>
      <p className="ai-note">
        Some Sentinel sources are always free. Use inventory mode to enter each source and total it,
        or query mode to paste the <code>FreeGBPerDay</code> total from the provided query.
      </p>
      <div className="segmented" role="tablist" aria-label="Always-free sizing mode">
        <button
          type="button"
          role="tab"
          aria-selected={alwaysFreeMode === "inventory"}
          className={alwaysFreeMode === "inventory" ? "active" : ""}
          onClick={() => setAlwaysFreeMode("inventory")}
        >
          Estimate from inventory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={alwaysFreeMode === "query"}
          className={alwaysFreeMode === "query" ? "active" : ""}
          onClick={() => setAlwaysFreeMode("query")}
        >
          Enter query total
        </button>
      </div>

      {alwaysFreeMode === "inventory" ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Always-free source</th>
                  <th className="num">GB/day</th>
                  <th aria-label="Remove row" />
                </tr>
              </thead>
              <tbody>
                {alwaysFreeRows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="text"
                        value={r.name}
                        placeholder="AzureActivity / OfficeActivity / etc."
                        onChange={(e) => setAlwaysFreeRow(i, { name: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        value={r.gbPerDay || ""}
                        placeholder="0"
                        onChange={(e) =>
                          setAlwaysFreeRow(i, { gbPerDay: Math.max(0, Number(e.target.value) || 0) })
                        }
                      />
                    </td>
                    <td>
                      {alwaysFreeRows.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeAlwaysFreeRow(i)}
                          aria-label="Remove source row"
                        >
                          x
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={addAlwaysFreeRow}>
              Add always-free row
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                setBenefit({ freeDataSourceGbPerDay: Number(alwaysFreeTotalGbPerDay.toFixed(3)) })
              }
            >
              Use calculated value
            </button>
          </div>
          <p className="ai-note">Calculated always-free total: {gbPerDay(alwaysFreeTotalGbPerDay)}</p>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="freesrc-query">Always-free sources (GB/day)</label>
            <input
              id="freesrc-query"
              type="number"
              min={0}
              value={b.freeDataSourceGbPerDay ?? ""}
              placeholder="0"
              onChange={(e) => setBenefit({ freeDataSourceGbPerDay: num(e.target.value) })}
            />
            <p className="ai-note">
              Run the query below and paste its <code>FreeGBPerDay</code> total.
            </p>
          </div>
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
        </>
      )}

      <div className="section-head">
        <span className="eyebrow">Defender for Servers Plan 2 benefit</span>
      </div>
      <p className="ai-note">
        P2 grants 500 MB/server/day of free eligible ingestion, pooled at subscription scope. Use
        inventory mode to estimate from per-log totals and server count, or query mode to paste the
        computed <code>FreeGBPerDay</code> directly.
      </p>
      <div className="segmented" role="tablist" aria-label="Defender P2 sizing mode">
        <button
          type="button"
          role="tab"
          aria-selected={defenderMode === "inventory"}
          className={defenderMode === "inventory" ? "active" : ""}
          onClick={() => setDefenderMode("inventory")}
        >
          Estimate from inventory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={defenderMode === "query"}
          className={defenderMode === "query" ? "active" : ""}
          onClick={() => setDefenderMode("query")}
        >
          Enter query total
        </button>
      </div>

      {defenderMode === "inventory" ? (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="defender-nodes">Servers with Defender P2 enabled</label>
              <input
                id="defender-nodes"
                type="number"
                min={0}
                value={defenderNodes || ""}
                placeholder="0"
                onChange={(e) => setDefenderNodes(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div className="field">
              <label htmlFor="defender-cost-node">P2 cost per server/month (USD)</label>
              <input
                id="defender-cost-node"
                type="number"
                min={0}
                value={defenderCostPerNode || ""}
                placeholder="0"
                onChange={(e) => setDefenderCostPerNode(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            <div className="field">
              <label htmlFor="defender-derived">Calculated free benefit (GB/day)</label>
              <input
                id="defender-derived"
                type="text"
                readOnly
                value={gbPerDay(defenderEstimatedFreeGbPerDay)}
              />
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Eligible log / table</th>
                  <th className="num">GB/day</th>
                  <th aria-label="Remove row" />
                </tr>
              </thead>
              <tbody>
                {defenderRows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        type="text"
                        value={r.name}
                        placeholder="SecurityEvent / WindowsEvent / etc."
                        onChange={(e) => setDefenderRow(i, { name: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        min={0}
                        value={r.gbPerDay || ""}
                        placeholder="0"
                        onChange={(e) => setDefenderRow(i, { gbPerDay: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    </td>
                    <td>
                      {defenderRows.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeDefenderRow(i)}
                          aria-label="Remove log row"
                        >
                          x
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={addDefenderRow}>
              Add eligible log row
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                setBenefit({ defenderP2FreeGbPerDay: Number(defenderEstimatedFreeGbPerDay.toFixed(3)) })
              }
            >
              Use calculated value
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Defender P2 economics</th>
                  <th className="num">Monthly</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Eligible ingest total (inventory)</td>
                  <td className="num">{gbPerDay(defenderEligibleGbPerDay)}</td>
                </tr>
                <tr>
                  <td>Benefit cap (servers x 500 MB/day)</td>
                  <td className="num">{gbPerDay(defenderCapGbPerDay)}</td>
                </tr>
                <tr>
                  <td>Estimated benefit value (avoided Analytics ingest)</td>
                  <td className="num">{money(defenderEstimatedMonthlyValue)}</td>
                </tr>
                <tr>
                  <td>Estimated P2 license cost</td>
                  <td className="num">{money(defenderMonthlyLicenseCost)}</td>
                </tr>
                <tr>
                  <td>Net value</td>
                  <td className="num">{money(defenderNetMonthlyValue)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="ai-note">
            Positive net value suggests the ingestion benefit alone may justify P2 cost. Negative net
            value means you should justify P2 with broader security value, not Sentinel ingestion alone.
          </p>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="def">Defender Servers P2 free benefit (GB/day)</label>
            <input
              id="def"
              type="number"
              min={0}
              value={b.defenderP2FreeGbPerDay ?? ""}
              placeholder="0"
              onChange={(e) => setBenefit({ defenderP2FreeGbPerDay: num(e.target.value) })}
            />
            <p className="ai-note">
              Run the query below and paste its <code>FreeGBPerDay</code> value.
            </p>
          </div>
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
        </>
      )}

      <details className="mt-sm">
        <summary>Size the Microsoft 365 qualifying-license benefit</summary>
        <p className="ai-note">
          The Microsoft Sentinel benefit for Microsoft 365 E5/A5/F5/G5 customers grants up to
          5 MB/user/day of free Sentinel ingestion across a fixed set of eligible Microsoft data
          types (Microsoft Entra ID logs, Microsoft 365/Office activity, Defender XDR &amp; Defender
          for Endpoint raw data, Defender for Cloud Apps Shadow IT, and Information Protection). The
          effective grant is the smaller of that eligible volume and your qualifying user count x
          5 MB.
        </p>
        <p className="ai-note">
          Qualifier examples include E5, A5, F5, and G5 families (tenant SKU mix determines exact
          eligibility).
        </p>
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
          security tables, pooled across the subscription.
        </p>
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
          Office 365 audit logs, and security alerts/incidents. (Raw Defender/Entra logs are still
          paid — only the alerts and listed source types are free.)
        </p>
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
