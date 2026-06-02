import {
  bytesToGbPerDay,
  computeTotals,
  type NormalizedResult,
  type NormalizedSource,
} from "../schema/normalization.js";

/**
 * Splunk parser.
 *
 * Accepts the JSON rows produced by a license-usage search. Each row reports a
 * Splunk index (`idx`) and its raw ingest volume in bytes.
 */

export interface SplunkUsageRow {
  idx: string;
  /** Raw ingest volume in bytes over the reporting window. */
  bytes: number;
  /** Optional event count for the index. */
  events?: number;
}

export interface SplunkInput {
  results: SplunkUsageRow[];
  /** Reporting window in days, used to derive gbPerDay. Defaults to 30. */
  windowDays?: number;
}

export function parseSplunk(input: SplunkInput): NormalizedResult {
  const windowDays = input.windowDays ?? 30;

  const sources: NormalizedSource[] = input.results.map((row) => {
    const source: NormalizedSource = {
      name: row.idx,
      bytes: row.bytes,
      gbPerDay: bytesToGbPerDay(row.bytes, windowDays),
    };
    if (row.events !== undefined) source.events = row.events;
    return source;
  });

  return {
    vendor: "splunk",
    sources,
    totals: computeTotals(sources),
  };
}
