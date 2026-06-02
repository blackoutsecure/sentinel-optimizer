/**
 * Data Volume Estimator.
 *
 * Estimates SIEM ingestion volume (GB/day) from an infrastructure inventory —
 * node/endpoint/user counts per data-source type — without touching any logs,
 * credentials, or live environment.
 *
 * Formula (per source):
 *   eps    = count × avgEpsPerNode
 *   GB/day = (avgEventSizeBytes × eps × 86400) / 1024³
 *
 * Uses binary gibibytes (1024³) for volume math. Pure and deterministic.
 */

import {
  type NormalizedResult,
  type NormalizedSource,
} from "../schema/normalization.js";

const SECONDS_PER_DAY = 24 * 60 * 60;
const BYTES_PER_GIB = 1024 ** 3;

/** Default sizing for a data-source type. */
export interface DataSourceProfile {
  /** Source type label. */
  name: string;
  /** Average event size in bytes. */
  avgEventSizeBytes: number;
  /** Average events per second per node/endpoint/user. */
  avgEpsPerNode: number;
  /** What a count represents for this source. */
  unit: "node" | "endpoint" | "user";
}

/** Default data-source catalog with nominal event sizes and EPS. */
export const DATA_SOURCE_CATALOG: readonly DataSourceProfile[] = [
  { name: "Azure AD Audit (Users)", avgEventSizeBytes: 2048, avgEpsPerNode: 0.000173611, unit: "user" },
  { name: "Azure AD Sign-ins (Users)", avgEventSizeBytes: 800, avgEpsPerNode: 0.001736111, unit: "user" },
  { name: "Windows Servers w/ high EPS", avgEventSizeBytes: 700, avgEpsPerNode: 7, unit: "node" },
  { name: "Windows Servers w/ medium EPS", avgEventSizeBytes: 700, avgEpsPerNode: 3, unit: "node" },
  { name: "Windows Servers w/ low EPS", avgEventSizeBytes: 700, avgEpsPerNode: 1, unit: "node" },
  { name: "Windows Domain Server", avgEventSizeBytes: 1000, avgEpsPerNode: 7, unit: "node" },
  { name: "Windows Desktops (Laptops, Tablets, POS)", avgEventSizeBytes: 745.65, avgEpsPerNode: 0.0005, unit: "endpoint" },
  { name: "HyperVisor (ESXi, Hyper-V etc)", avgEventSizeBytes: 1000, avgEpsPerNode: 15, unit: "node" },
  { name: "Linux / Unix Servers", avgEventSizeBytes: 300, avgEpsPerNode: 3, unit: "node" },
  { name: "Network Firewalls (DMZ)", avgEventSizeBytes: 250, avgEpsPerNode: 50, unit: "node" },
  { name: "Network Firewalls (Internal)", avgEventSizeBytes: 250, avgEpsPerNode: 240, unit: "node" },
  { name: "Network Flows (NetFlow/S-Flow)", avgEventSizeBytes: 400, avgEpsPerNode: 30, unit: "node" },
  { name: "Network IPS/IDS", avgEventSizeBytes: 300, avgEpsPerNode: 100, unit: "node" },
  { name: "Network Load-Balancers", avgEventSizeBytes: 150, avgEpsPerNode: 5, unit: "node" },
  { name: "Network Gateway/Routers", avgEventSizeBytes: 250, avgEpsPerNode: 1, unit: "node" },
  { name: "Network Switches", avgEventSizeBytes: 100, avgEpsPerNode: 30, unit: "node" },
  { name: "Network VPN / SSL VPN", avgEventSizeBytes: 300, avgEpsPerNode: 2, unit: "node" },
  { name: "Network Web Proxy", avgEventSizeBytes: 650, avgEpsPerNode: 20, unit: "node" },
  { name: "Network Wireless LAN", avgEventSizeBytes: 150, avgEpsPerNode: 5, unit: "node" },
  { name: "Other Network Devices", avgEventSizeBytes: 250, avgEpsPerNode: 10, unit: "node" },
  { name: "Other Security Devices", avgEventSizeBytes: 750, avgEpsPerNode: 5, unit: "node" },
];

/** One row of the estimator input: how many nodes of a given source type. */
export interface DataVolumeInputRow {
  /** Must match a `name` in {@link DATA_SOURCE_CATALOG}. */
  name: string;
  /** Number of nodes / endpoints / users. */
  count: number;
  /** Optional override of the catalog default event size (bytes). */
  avgEventSizeBytes?: number;
  /** Optional override of the catalog default EPS per node. */
  avgEpsPerNode?: number;
}

export interface DataVolumeInput {
  rows: DataVolumeInputRow[];
}

/** GB/day for a single sizing triple, using binary GiB. */
export function rowGbPerDay(
  avgEventSizeBytes: number,
  avgEpsPerNode: number,
  count: number,
): number {
  const eps = count * avgEpsPerNode;
  return (avgEventSizeBytes * eps * SECONDS_PER_DAY) / BYTES_PER_GIB;
}

/**
 * Estimate ingestion volume from an infrastructure inventory.
 *
 * Unknown source names (not in the catalog) are ignored unless the row supplies
 * both `avgEventSizeBytes` and `avgEpsPerNode` overrides.
 */
export function estimateDataVolume(input: DataVolumeInput): NormalizedResult {
  const catalog = new Map(DATA_SOURCE_CATALOG.map((p) => [p.name, p]));

  const sources: NormalizedSource[] = [];
  for (const row of input.rows) {
    const profile = catalog.get(row.name);
    const avgEventSizeBytes = row.avgEventSizeBytes ?? profile?.avgEventSizeBytes;
    const avgEpsPerNode = row.avgEpsPerNode ?? profile?.avgEpsPerNode;
    if (avgEventSizeBytes === undefined || avgEpsPerNode === undefined) continue;

    sources.push({
      name: row.name,
      gbPerDay: rowGbPerDay(avgEventSizeBytes, avgEpsPerNode, row.count),
    });
  }

  const gbPerDay = sources.reduce((acc, s) => acc + (s.gbPerDay ?? 0), 0);

  return {
    vendor: "sentinel",
    sources,
    totals: { gbPerDay },
  };
}
