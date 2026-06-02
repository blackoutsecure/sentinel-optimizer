import {
  bytesToGbPerDay,
  computeTotals,
  type NormalizedResult,
  type NormalizedSource,
} from "../schema/normalization.js";

/**
 * Elasticsearch parser.
 *
 * Accepts the JSON rows produced by the `_cat/indices` API with byte units.
 * Each row reports an index, its document count, and primary store size. The
 * `_cat` API returns numeric fields as strings, so they are coerced.
 */

export interface ElasticCatIndexRow {
  index: string;
  "docs.count"?: string | number;
  "store.size"?: string | number;
}

export interface ElasticInput {
  indices: ElasticCatIndexRow[];
  /** Reporting window in days, used to derive gbPerDay. Defaults to 30. */
  windowDays?: number;
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parseElastic(input: ElasticInput): NormalizedResult {
  const windowDays = input.windowDays ?? 30;

  const sources: NormalizedSource[] = input.indices.map((row) => {
    const source: NormalizedSource = { name: row.index };

    const bytes = toNumber(row["store.size"]);
    if (bytes !== undefined) {
      source.bytes = bytes;
      source.gbPerDay = bytesToGbPerDay(bytes, windowDays);
    }

    const events = toNumber(row["docs.count"]);
    if (events !== undefined) source.events = events;

    return source;
  });

  return {
    vendor: "elastic",
    sources,
    totals: computeTotals(sources),
  };
}
