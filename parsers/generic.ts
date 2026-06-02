import {
  bytesToGbPerDay,
  computeTotals,
  type NormalizedResult,
  type NormalizedSource,
  type Vendor,
} from "../schema/normalization.js";

/**
 * Generic SIEM parser.
 *
 * Many SIEM / log platforms can export an ingestion-by-source report as a flat
 * array of rows, but each names its columns differently (`bytes`, `sizeInBytes`,
 * `store.size`, `volume`, `GB`, `eventcount`, …). Rather than hand-write a
 * bespoke parser for every vendor, this parser tolerantly auto-detects the
 * source-name column and the size/volume column, coercing strings to numbers.
 *
 * It accepts either a bare array of rows or an object wrapping the rows under a
 * common key (`sources`, `results`, `rows`, `data`, `indices`). When a row
 * reports only an event count and {@link GenericParseOptions.avgEventBytes} is
 * provided, volume is estimated as `events * avgEventBytes` (used for EPS-based
 * platforms such as QRadar that do not report raw bytes).
 */

export type GenericRow = Record<string, unknown>;

export interface GenericInput {
  windowDays?: number;
  sources?: GenericRow[];
  results?: GenericRow[];
  rows?: GenericRow[];
  data?: GenericRow[];
  indices?: GenericRow[];
}

export interface GenericParseOptions {
  vendor: Vendor;
  /** Bytes-per-event used to estimate volume when a row reports only events. */
  avgEventBytes?: number;
  /** Window used to derive gbPerDay when a row lacks it. Defaults to 30. */
  defaultWindowDays?: number;
}

const NAME_KEYS = [
  "name",
  "source",
  "sourcecategory",
  "sourceCategory",
  "source_category",
  "_sourceCategory",
  "_sourcecategory",
  "#repo",
  "log_set",
  "logset",
  "logSet",
  "log_source_name",
  "logsource",
  "log_source",
  "logSourceName",
  "index",
  "idx",
  "repo",
  "table",
  "dataType",
  "DataType",
  "category",
  "host",
  "stream",
  "feed",
  "collector",
  "product",
  "log_type",
  "logType",
];

const BYTES_KEYS = [
  "bytes",
  "size",
  "sizeInBytes",
  "size_bytes",
  "sizeBytes",
  "store.size",
  "storeSize",
  "volume",
  "volumeBytes",
  "volume_bytes",
  "byteCount",
  "rawBytes",
  "raw_bytes",
  "ingestBytes",
  "ingest_bytes",
  "totalBytes",
  "b",
];

const GB_KEYS = ["gb", "gigabytes", "sizeGB", "gbVolume", "volumeGB", "gbTotal", "GB"];
const MB_KEYS = ["mb", "megabytes", "QuantityMB", "quantityMB", "sizeMB", "MB"];
const GBPERDAY_KEYS = ["gbPerDay", "gb_per_day", "gbPerDayAvg", "dailyGB", "gbDay"];
const EVENTS_KEYS = [
  "events",
  "count",
  "eventCount",
  "event_count",
  "eventcount",
  "docs.count",
  "records",
  "hits",
  "messages",
];

const GB_TO_BYTES = 1_000_000_000;
const MB_TO_BYTES = 1_000_000;

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const n = Number(value.replace(/[, ]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function firstString(row: GenericRow, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function firstNumber(row: GenericRow, keys: string[]): number | undefined {
  for (const key of keys) {
    if (key in row) {
      const n = toNumber(row[key]);
      if (n !== undefined) return n;
    }
  }
  return undefined;
}

function pickRows(input: GenericInput | GenericRow[]): GenericRow[] {
  if (Array.isArray(input)) return input as GenericRow[];
  for (const key of ["sources", "results", "rows", "data", "indices"] as const) {
    const arr = input[key];
    if (Array.isArray(arr)) return arr as GenericRow[];
  }
  return [];
}

export function parseGeneric(
  input: GenericInput | GenericRow[],
  opts: GenericParseOptions,
): NormalizedResult {
  const windowDays =
    (!Array.isArray(input) ? input.windowDays : undefined) ?? opts.defaultWindowDays ?? 30;

  const rows = pickRows(input);

  const sources: NormalizedSource[] = rows.map((row, i) => {
    const source: NormalizedSource = { name: firstString(row, NAME_KEYS) ?? `source-${i + 1}` };

    let bytes = firstNumber(row, BYTES_KEYS);
    if (bytes === undefined) {
      const gb = firstNumber(row, GB_KEYS);
      if (gb !== undefined) bytes = gb * GB_TO_BYTES;
    }
    if (bytes === undefined) {
      const mb = firstNumber(row, MB_KEYS);
      if (mb !== undefined) bytes = mb * MB_TO_BYTES;
    }

    const events = firstNumber(row, EVENTS_KEYS);
    if (events !== undefined) source.events = events;

    if (bytes === undefined && events !== undefined && opts.avgEventBytes !== undefined) {
      bytes = events * opts.avgEventBytes;
    }

    if (bytes !== undefined) {
      source.bytes = bytes;
      source.gbPerDay = bytesToGbPerDay(bytes, windowDays);
    }

    const gbPerDay = firstNumber(row, GBPERDAY_KEYS);
    if (gbPerDay !== undefined) {
      source.gbPerDay = gbPerDay;
      if (source.bytes === undefined) source.bytes = gbPerDay * windowDays * GB_TO_BYTES;
    }

    return source;
  });

  return {
    vendor: opts.vendor,
    sources,
    totals: computeTotals(sources),
  };
}
