import { useState } from "react";
import type { NormalizedResult } from "@engine/schema/normalization.js";
import { estimateDataVolume, DATA_SOURCE_CATALOG, rowGbPerDay } from "@engine/estimators/index.js";
import type { ExportProvenance } from "../lib/exporters.js";
import { INVENTORY_EXAMPLE } from "../lib/examples.js";
import { gbPerDay } from "../lib/format.js";

interface Props {
  onEstimated: (result: NormalizedResult, provenance: ExportProvenance) => void;
}

interface Row {
  name: string;
  count: number;
}

const CATALOG = DATA_SOURCE_CATALOG;

function rowGb(name: string, count: number): number {
  const p = CATALOG.find((c) => c.name === name);
  if (!p) return 0;
  return rowGbPerDay(p.avgEventSizeBytes, p.avgEpsPerNode, count);
}

export default function InventoryWizard({ onEstimated }: Props) {
  const [rows, setRows] = useState<Row[]>(() => [{ name: CATALOG[0]!.name, count: 100 }]);

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    const used = new Set(rows.map((r) => r.name));
    const next = CATALOG.find((c) => !used.has(c.name)) ?? CATALOG[0]!;
    setRows((prev) => [...prev, { name: next.name, count: 10 }]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function loadExample() {
    setRows(INVENTORY_EXAMPLE.map((r) => ({ ...r })));
  }

  const total = rows.reduce((a, r) => a + rowGb(r.name, r.count), 0);

  function estimate() {
    const result = estimateDataVolume({ rows: rows.map((r) => ({ name: r.name, count: r.count })) });
    onEstimated(result, {
      mode: "inventory-estimate",
      inventoryRows: rows.map((r) => ({ name: r.name, count: r.count })),
    });
  }

  return (
    <div className="stack">
      <p className="ai-note">
        No logs to paste? Estimate ingestion from your infrastructure inventory using nominal event
        sizes and rates. Runs entirely in your browser.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Source type</th>
              <th style={{ width: "9rem" }}>Count</th>
              <th style={{ width: "8rem" }}>GB/day</th>
              <th aria-label="Remove" style={{ width: "3rem" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const unit = CATALOG.find((c) => c.name === r.name)?.unit ?? "node";
              return (
                <tr key={i}>
                  <td>
                    <select value={r.name} onChange={(e) => update(i, { name: e.target.value })}>
                      {CATALOG.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={r.count}
                      aria-label={`Number of ${unit}s`}
                      onChange={(e) => update(i, { count: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </td>
                  <td>{gbPerDay(rowGb(r.name, r.count))}</td>
                  <td>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label="Remove row"
                        onClick={() => removeRow(i)}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th />
              <th>{gbPerDay(total)}</th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={estimate}>
          Estimate volume
        </button>
        <button type="button" className="btn btn-secondary" onClick={addRow}>
          Add source
        </button>
        <button type="button" className="btn btn-ghost" onClick={loadExample}>
          Load example
        </button>
      </div>
    </div>
  );
}
