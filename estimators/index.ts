/**
 * Estimators registry.
 *
 * Estimators derive normalized ingestion volume from inventory inputs rather
 * than from exported logs, producing the same normalized result as parsers.
 */

export {
  estimateDataVolume,
  rowGbPerDay,
  DATA_SOURCE_CATALOG,
} from "./dataVolumeEstimator.js";
export type {
  DataSourceProfile,
  DataVolumeInput,
  DataVolumeInputRow,
} from "./dataVolumeEstimator.js";
