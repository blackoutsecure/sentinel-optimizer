import { useMemo } from "react";
import type { NormalizedResult } from "@engine/schema/normalization.js";
import type {
  SentinelCostInput,
  TableRetention,
} from "@engine/pricing/sentinelPricing.js";
import { gbPerDay } from "../lib/format.js";

interface Props {
  result: NormalizedResult;
  input: SentinelCostInput;
  onChange: (patch: Partial<SentinelCostInput>) => void;
}

/** Default interactive retention: 90 days ≈ 3 months (free with Sentinel). */
const DEFAULT_INTERACTIVE_MONTHS = 3;

/** Quick presets for "apply to all" — label + interactive months. */
const PRESETS: { label: string; months: number }[] = [
  { label: "90 days", months: 3 },
  { label: "6 months", months: 6 },
  { label: "1 year", months: 12 },
  { label: "2 years", months: 24 },
];

function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

type TableLane = "analytics" | "basicAux" | "dataLake" | "auto";

export default function RetentionTable({ result, input, onChange }: Props) {
  const enabled = input.tableRetention != null;

  const sources = useMemo(
    () => [...result.sources].sort((a, b) => (b.gbPerDay ?? 0) - (a.gbPerDay ?? 0)),
    [result.sources],
  );

  function seedRows(): TableRetention[] {
    return sources.map((s) => ({
      name: s.name,
      gbPerDay: s.gbPerDay ?? 0,
      lane: "auto",
      interactiveMonths: DEFAULT_INTERACTIVE_MONTHS,
      totalMonths: DEFAULT_INTERACTIVE_MONTHS,
    }));
  }

  function toggle(on: boolean) {
    onChange({ tableRetention: on ? seedRows() : undefined });
  }

  const rows = input.tableRetention ?? [];

  function patchRow(name: string, patch: Partial<TableRetention>) {
    onChange({
      tableRetention: rows.map((r) => (r.name === name ? { ...r, ...patch } : r)),
    });
  }

  function applyAllInteractive(months: number) {
    onChange({
      tableRetention: rows.map((r) => ({
        ...r,
        interactiveMonths: months,
        totalMonths: Math.max(r.totalMonths ?? months, months),
      })),
    });
  }

  function applyAllLane(lane: TableLane) {
    onChange({
      tableRetention: rows.map((r) => ({
        ...r,
        lane,
      })),
    });
  }

  return (
    <div className="stack">
      <div className="section-head">
        <span className="eyebrow">Retention by table</span>
        <label className="switch-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => toggle(e.target.checked)}
          />
          Set retention per table
        </label>
      </div>

      {!enabled ? (
        <p className="ai-note">
          Using a single retention window for all data (see the cost controls). Sentinel keeps
          the first 90 days of interactive retention free. Turn this on to tune retention per
          table — keep high-value tables hot for longer and archive or trim noisy ones.
        </p>
      ) : (
        <>
          <div className="preset-row">
            <span className="muted">Apply interactive retention to all:</span>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => applyAllInteractive(p.months)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="preset-row">
            <span className="muted">Apply ingestion plan to all:</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyAllLane("auto")}>
              Auto
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyAllLane("analytics")}>
              Analytics
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyAllLane("basicAux")}>
              Basic / Auxiliary
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyAllLane("dataLake")}>
              Data Lake
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <caption className="sr-only">Per-table retention settings</caption>
              <thead>
                <tr>
                  <th>Table / source</th>
                  <th>Ingestion plan</th>
                  <th className="num">GB/day</th>
                  <th className="num">Interactive (months)</th>
                  <th className="num">Total incl. archive (months)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const interactive = row.interactiveMonths ?? DEFAULT_INTERACTIVE_MONTHS;
                  const total = row.totalMonths ?? interactive;
                  return (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>
                        <select
                          value={row.lane ?? "auto"}
                          aria-label={`Ingestion plan for ${row.name}`}
                          onChange={(e) =>
                            patchRow(row.name, { lane: e.target.value as TableLane })
                          }
                        >
                          <option value="auto">Auto (suggest)</option>
                          <option value="analytics">Analytics</option>
                          <option value="basicAux">Basic / Auxiliary</option>
                          <option value="dataLake">Data Lake</option>
                        </select>
                      </td>
                      <td className="num">{gbPerDay(row.gbPerDay)}</td>
                      <td className="num">
                        <input
                          className="cell-input"
                          type="number"
                          min={0}
                          max={24}
                          value={interactive}
                          aria-label={`Interactive retention months for ${row.name}`}
                          onChange={(e) =>
                            patchRow(row.name, { interactiveMonths: num(e.target.value) ?? 0 })
                          }
                        />
                      </td>
                      <td className="num">
                        <input
                          className="cell-input"
                          type="number"
                          min={0}
                          max={144}
                          value={total}
                          aria-label={`Total retention months for ${row.name}`}
                          onChange={(e) =>
                            patchRow(row.name, { totalMonths: num(e.target.value) ?? 0 })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="ai-note">
            Interactive = fast query access (first 90 days free, then billed per GB·month). Total
            beyond the interactive window is cheap long-term archive. Ingestion plan controls where
            the table is priced (Analytics, Basic/Aux, Data Lake). Auto uses retention-based
            heuristics and can be overridden per table.
          </p>
        </>
      )}
    </div>
  );
}
