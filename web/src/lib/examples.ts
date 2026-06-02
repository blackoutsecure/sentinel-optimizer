/**
 * Built-in example payloads for each vendor + the inventory estimator.
 *
 * These mirror `samples/*.json` in the engine repo so the UI can offer a
 * "Load example" button without a network round trip. Kept as strings so the
 * paste box can show exactly what a user would paste from their own SIEM.
 */

export type Vendor = "sentinel" | "splunk" | "elastic";

export interface VendorMeta {
  id: Vendor;
  label: string;
  /** What to paste, in plain language. */
  hint: string;
  example: string;
}

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

export const ELASTIC_EXAMPLE = `{
  "windowDays": 30,
  "indices": [
    { "index": "logs-2026.05", "docs.count": "12500000", "store.size": "21474836480" },
    { "index": "metrics-2026.05", "docs.count": "8000000", "store.size": "5368709120" },
    { "index": "audit-2026.05", "docs.count": "450000" }
  ]
}`;

export const VENDORS: VendorMeta[] = [
  {
    id: "sentinel",
    label: "Microsoft Sentinel",
    hint: 'Paste the JSON rows from a KQL Usage query (DataType + QuantityMB). Optional: data connectors.',
    example: SENTINEL_EXAMPLE,
  },
  {
    id: "splunk",
    label: "Splunk",
    hint: "Paste the JSON results of a license-usage search (index + bytes, optional events).",
    example: SPLUNK_EXAMPLE,
  },
  {
    id: "elastic",
    label: "Elastic",
    hint: "Paste the JSON from `_cat/indices?bytes=b&format=json` (index, docs.count, store.size).",
    example: ELASTIC_EXAMPLE,
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
