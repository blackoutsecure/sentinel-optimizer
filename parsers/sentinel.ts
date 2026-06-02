import {
  bytesToGbPerDay,
  computeTotals,
  type NormalizedConnector,
  type NormalizedResult,
  type NormalizedSource,
} from "../schema/normalization.js";

/**
 * Microsoft Sentinel parser.
 *
 * Accepts the JSON rows produced by a KQL Usage query. `Quantity` in the Usage
 * table is reported in megabytes, so each row's `QuantityMB` is converted to
 * bytes. Optional data connectors may be supplied from a separate export.
 */

export interface SentinelUsageRow {
  DataType: string;
  /** Sum of `Quantity` from the Usage table, in megabytes. */
  QuantityMB: number;
}

export interface SentinelConnectorRow {
  name: string;
  kind?: string;
  enabled?: boolean;
}

export interface SentinelInput {
  usage: SentinelUsageRow[];
  connectors?: SentinelConnectorRow[];
  /** Reporting window in days, used to derive gbPerDay. Defaults to 30. */
  windowDays?: number;
}

const MB_TO_BYTES = 1_000_000;

export function parseSentinel(input: SentinelInput): NormalizedResult {
  const windowDays = input.windowDays ?? 30;

  const sources: NormalizedSource[] = input.usage.map((row) => {
    const bytes = Math.round(row.QuantityMB * MB_TO_BYTES);
    return {
      name: row.DataType,
      bytes,
      gbPerDay: bytesToGbPerDay(bytes, windowDays),
    };
  });

  const result: NormalizedResult = {
    vendor: "sentinel",
    sources,
    totals: computeTotals(sources),
  };

  if (input.connectors && input.connectors.length > 0) {
    const connectors: NormalizedConnector[] = input.connectors.map((c) => {
      const connector: NormalizedConnector = { name: c.name };
      if (c.kind !== undefined) connector.kind = c.kind;
      if (c.enabled !== undefined) connector.enabled = c.enabled;
      return connector;
    });
    result.connectors = connectors;
  }

  return result;
}
