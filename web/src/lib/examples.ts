/**
 * Built-in per-vendor metadata: the query a user runs in their SIEM to produce
 * an ingestion-by-source export, plus an example payload to paste back.
 *
 * Step 1 of the UI shows `query` (copyable) for the selected vendor; the user
 * runs it, exports the JSON results, and pastes them into the box. Examples
 * mirror the shape each query produces so "Load example" shows exactly what a
 * real paste looks like. Everything is parsed in the browser — nothing uploads.
 */

export type Vendor =
  | "sentinel"
  | "splunk"
  | "elastic"
  | "rapid7"
  | "qradar"
  | "sumologic"
  | "logscale"
  | "chronicle"
  | "datadog";

/** Which engine parser handles a vendor's paste. */
export type ParserKind = "sentinel" | "splunk" | "elastic" | "generic";

export interface VendorMeta {
  id: Vendor;
  label: string;
  /** Engine parser to route the paste through. */
  parser: ParserKind;
  /** Where the query runs, e.g. "Log Analytics · KQL". */
  queryLang: string;
  /** Copyable query/command that produces the export. */
  query: string;
  /** What to paste back, in plain language. */
  hint: string;
  /** Example payload matching the query output shape. */
  example: string;
  /**
   * For EPS-based platforms that report only event counts, estimate volume as
   * `events * avgEventBytes`. Users can refine in the cost model.
   */
  avgEventBytes?: number;
}

/* ------------------------------------------------------------------ queries */

const SENTINEL_QUERY = `// Microsoft Sentinel · Logs (Log Analytics) — run, then Export > JSON
Usage
| where TimeGenerated > ago(30d) and IsBillable == true
| summarize QuantityMB = sum(Quantity) by DataType
| order by QuantityMB desc`;

const SPLUNK_QUERY = `index=_internal source=*license_usage.log type=Usage earliest=-30d@d
| stats sum(b) AS bytes count AS events BY idx
| sort - bytes`;

const ELASTIC_QUERY = `GET _cat/indices?bytes=b&format=json&h=index,docs.count,store.size&s=store.size:desc`;

const RAPID7_QUERY = `// InsightIDR · Log Search (LEQL) — select all log sets, last 30 days.
// If your logs expose a size field, sum it; otherwise export the per-log-set
// event counts and InsightIDR > Settings > Data Collection > Data Usage (GB).
where(/.*/)
groupby(log_source_name)
calculate(sum:size_bytes)`;

const QRADAR_QUERY = `-- IBM QRadar · Log Activity > Advanced Search (AQL)
SELECT LOGSOURCENAME(logsourceid) AS name, SUM(eventcount) AS events
FROM events
GROUP BY logsourceid
ORDER BY events DESC
LAST 30 DAYS`;

const SUMOLOGIC_QUERY = `_index=sumologic_volume
| sum(sizeInBytes) as bytes by _sourceCategory
| sort by bytes`;

const LOGSCALE_QUERY = `// CrowdStrike Falcon LogScale / NG-SIEM — last 30 days, search all repos
#repo=*
| groupBy([#repo], function=sum(@rawstring.length, as=bytes))
| sort(bytes, order=desc)`;

const CHRONICLE_QUERY = `-- Google SecOps (Chronicle) · BigQuery export of ingestion metrics
SELECT log_type AS name, SUM(size_bytes) AS bytes
FROM \`datalake.ingestion_metrics\`
WHERE _PARTITIONDATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY log_type
ORDER BY bytes DESC`;

const DATADOG_QUERY = `# Datadog · Logs > Usage (or Usage Metering API), last 30 days.
# Export rows of { "source": <log source>, "gb": <ingested GB> }.
# API: GET https://api.datadoghq.com/api/v2/usage/logs_by_retention`;

/* ----------------------------------------------------------------- examples */

export const SENTINEL_EXAMPLE = `{
  "windowDays": 30,
  "usage": [
    { "DataType": "SecurityEvent", "QuantityMB": 1228800 },
    { "DataType": "SigninLogs", "QuantityMB": 307200 },
    { "DataType": "CommonSecurityLog", "QuantityMB": 921600 }
  ],
  "connectors": [
    { "name": "AzureActiveDirectory", "kind": "AzureActiveDirectory", "enabled": true },
    { "name": "MicrosoftThreatProtection", "kind": "MicrosoftThreatProtection", "enabled": false }
  ]
}`;

export const SPLUNK_EXAMPLE = `{
  "windowDays": 30,
  "results": [
    { "idx": "main", "bytes": 32212254720, "events": 48000000 },
    { "idx": "firewall", "bytes": 16106127360, "events": 21000000 },
    { "idx": "windows", "bytes": 8053063680 }
  ]
}`;

export const ELASTIC_EXAMPLE = `[
  { "index": "logs-2026.05", "docs.count": "12500000", "store.size": "21474836480" },
  { "index": "metrics-2026.05", "docs.count": "8000000", "store.size": "5368709120" },
  { "index": "audit-2026.05", "docs.count": "450000" }
]`;

export const RAPID7_EXAMPLE = `{
  "windowDays": 30,
  "sources": [
    { "name": "AWS CloudTrail", "bytes": 18253611008 },
    { "name": "Windows Event Log", "bytes": 9663676416 },
    { "name": "Palo Alto Firewall", "bytes": 5368709120 }
  ]
}`;

export const QRADAR_EXAMPLE = `{
  "windowDays": 30,
  "results": [
    { "name": "Cisco ASA", "events": 240000000 },
    { "name": "Windows Security", "events": 180000000 },
    { "name": "Linux Auth", "events": 36000000 }
  ]
}`;

export const SUMOLOGIC_EXAMPLE = `{
  "windowDays": 30,
  "results": [
    { "_sourceCategory": "prod/aws/cloudtrail", "bytes": 21474836480 },
    { "_sourceCategory": "prod/firewall/palo", "bytes": 12884901888 },
    { "_sourceCategory": "prod/os/linux", "bytes": 6442450944 }
  ]
}`;

export const LOGSCALE_EXAMPLE = `{
  "windowDays": 30,
  "rows": [
    { "#repo": "edr", "bytes": 32212254720 },
    { "#repo": "firewall", "bytes": 10737418240 },
    { "#repo": "identity", "bytes": 4294967296 }
  ]
}`;

export const CHRONICLE_EXAMPLE = `{
  "windowDays": 30,
  "sources": [
    { "name": "WINEVTLOG", "bytes": 16106127360 },
    { "name": "GCP_CLOUDAUDIT", "bytes": 9663676416 },
    { "name": "PAN_FIREWALL", "bytes": 6442450944 }
  ]
}`;

export const DATADOG_EXAMPLE = `{
  "windowDays": 30,
  "rows": [
    { "source": "cloudtrail", "gb": 540 },
    { "source": "nginx", "gb": 320 },
    { "source": "kubernetes", "gb": 210 }
  ]
}`;

/* ------------------------------------------------------------------ vendors */

export const VENDORS: VendorMeta[] = [
  {
    id: "sentinel",
    label: "Microsoft Sentinel",
    parser: "sentinel",
    queryLang: "Log Analytics · KQL",
    query: SENTINEL_QUERY,
    hint: "Paste the JSON rows from the Usage query (DataType + QuantityMB). Optional: data connectors.",
    example: SENTINEL_EXAMPLE,
  },
  {
    id: "splunk",
    label: "Splunk",
    parser: "splunk",
    queryLang: "Search · SPL",
    query: SPLUNK_QUERY,
    hint: "Paste the JSON results of the license-usage search (idx + bytes, optional events).",
    example: SPLUNK_EXAMPLE,
  },
  {
    id: "elastic",
    label: "Elastic",
    parser: "elastic",
    queryLang: "Dev Tools · _cat API",
    query: ELASTIC_QUERY,
    hint: "Paste the JSON from `_cat/indices?bytes=b&format=json` (index, docs.count, store.size).",
    example: ELASTIC_EXAMPLE,
  },
  {
    id: "rapid7",
    label: "Rapid7 InsightIDR",
    parser: "generic",
    queryLang: "Log Search · LEQL",
    query: RAPID7_QUERY,
    hint: "Paste rows of { name, bytes } per log set. No size field? Use Settings > Data Collection > Data Usage (export GB per source).",
    example: RAPID7_EXAMPLE,
  },
  {
    id: "qradar",
    label: "IBM QRadar",
    parser: "generic",
    queryLang: "Log Activity · AQL",
    query: QRADAR_QUERY,
    hint: "Paste rows of { name, events } per log source. QRadar is EPS-based — volume is estimated at ~0.5 KB/event; refine in the cost model.",
    example: QRADAR_EXAMPLE,
    avgEventBytes: 512,
  },
  {
    id: "sumologic",
    label: "Sumo Logic",
    parser: "generic",
    queryLang: "Search · Data Volume index",
    query: SUMOLOGIC_QUERY,
    hint: "Paste rows of { _sourceCategory, bytes } from the sumologic_volume index.",
    example: SUMOLOGIC_EXAMPLE,
  },
  {
    id: "logscale",
    label: "CrowdStrike LogScale",
    parser: "generic",
    queryLang: "Falcon LogScale · query",
    query: LOGSCALE_QUERY,
    hint: "Paste rows of { #repo, bytes } summed from @rawstring.length per repository.",
    example: LOGSCALE_EXAMPLE,
  },
  {
    id: "chronicle",
    label: "Google SecOps (Chronicle)",
    parser: "generic",
    queryLang: "BigQuery · ingestion metrics",
    query: CHRONICLE_QUERY,
    hint: "Paste rows of { name, bytes } per log_type from the ingestion-metrics export.",
    example: CHRONICLE_EXAMPLE,
  },
  {
    id: "datadog",
    label: "Datadog",
    parser: "generic",
    queryLang: "Logs · Usage / API",
    query: DATADOG_QUERY,
    hint: "Paste rows of { source, gb } of ingested volume by log source for the window.",
    example: DATADOG_EXAMPLE,
  },
];

/** Default inventory rows for the estimator wizard (matches the engine sample). */
export const INVENTORY_EXAMPLE: { name: string; count: number }[] = [
  { name: "Azure AD Audit (Users)", count: 5000 },
  { name: "Azure AD Sign-ins (Users)", count: 5000 },
  { name: "Windows Servers w/ medium EPS", count: 200 },
  { name: "Linux / Unix Servers", count: 150 },
  { name: "Network Firewalls (DMZ)", count: 4 },
  { name: "Network IPS/IDS", count: 6 },
];
