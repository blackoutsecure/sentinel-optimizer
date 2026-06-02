/**
 * Universal SIEM Collector — normalization schema.
 *
 * Every vendor parser normalizes its raw query/export output into the
 * {@link NormalizedResult} shape so downstream cost modeling, migration
 * estimation, and optimization operate on a single unified structure.
 */

/** Known SIEM vendors supported by the collector. */
export type Vendor =
  | "splunk"
  | "qradar"
  | "elastic"
  | "sumologic"
  | "chronicle"
  | "exabeam"
  | "logrhythm"
  | "arcticwolf"
  | "rapid7"
  | "logscale"
  | "datadog"
  | "sentinel";

/** A single log source / index / table reported by a vendor. */
export interface NormalizedSource {
  /** Human-readable source name (index, table, log type, etc.). */
  name: string;
  /** Event count over the reporting window, if known. */
  events?: number;
  /** Raw byte volume over the reporting window, if known. */
  bytes?: number;
  /** Average ingest volume in GB/day, if known or derivable. */
  gbPerDay?: number;
  /** Storage tier / retention descriptor (vendor-specific string). */
  storage?: string;
}

/** A data connector reported by a vendor (e.g. Sentinel data connectors). */
export interface NormalizedConnector {
  name: string;
  kind?: string;
  enabled?: boolean;
}

/** A Data Collection Rule (Microsoft Sentinel / Azure Monitor). */
export interface NormalizedDcr {
  name: string;
  streams?: string[];
  destination?: string;
}

/** Aggregate totals across all sources. */
export interface NormalizedTotals {
  gbPerDay?: number;
  events?: number;
  bytes?: number;
}

/** The canonical normalized result produced by every vendor parser. */
export interface NormalizedResult {
  vendor: Vendor;
  sources: NormalizedSource[];
  connectors?: NormalizedConnector[];
  dcrs?: NormalizedDcr[];
  totals?: NormalizedTotals;
}

/** Bytes in one gigabyte (decimal, matching SIEM vendor billing conventions). */
export const BYTES_PER_GB = 1_000_000_000;

/** Convert a byte count to GB/day given a reporting window in days. */
export function bytesToGbPerDay(bytes: number, windowDays: number): number {
  if (windowDays <= 0) return 0;
  return bytes / BYTES_PER_GB / windowDays;
}

/**
 * Compute aggregate totals from a list of sources.
 *
 * A field is only included in the result when at least one source reports it,
 * keeping the output faithful to the data actually provided.
 */
export function computeTotals(sources: NormalizedSource[]): NormalizedTotals {
  const totals: NormalizedTotals = {};

  const sum = (pick: (s: NormalizedSource) => number | undefined): number | undefined => {
    let acc = 0;
    let seen = false;
    for (const source of sources) {
      const value = pick(source);
      if (typeof value === "number" && Number.isFinite(value)) {
        acc += value;
        seen = true;
      }
    }
    return seen ? acc : undefined;
  };

  const gbPerDay = sum((s) => s.gbPerDay);
  const events = sum((s) => s.events);
  const bytes = sum((s) => s.bytes);

  if (gbPerDay !== undefined) totals.gbPerDay = gbPerDay;
  if (events !== undefined) totals.events = events;
  if (bytes !== undefined) totals.bytes = bytes;

  return totals;
}
