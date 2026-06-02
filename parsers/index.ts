/**
 * Parser registry.
 *
 * Re-exports each vendor parser. Parsers are intentionally typed per-vendor
 * rather than behind a single union signature, because each vendor's raw
 * input shape differs. UI code should import the specific parser it needs.
 */

export { parseSentinel } from "./sentinel.js";
export type {
  SentinelInput,
  SentinelUsageRow,
  SentinelConnectorRow,
} from "./sentinel.js";

export { parseSplunk } from "./splunk.js";
export type { SplunkInput, SplunkUsageRow } from "./splunk.js";

export { parseElastic } from "./elastic.js";
export type { ElasticInput, ElasticCatIndexRow } from "./elastic.js";
