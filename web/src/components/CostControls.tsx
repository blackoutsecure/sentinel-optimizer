import type { SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import { gbPerDay } from "../lib/format.js";

interface Props {
  input: SentinelCostInput;
  onChange: (patch: Partial<SentinelCostInput>) => void;
}

function num(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export default function CostControls({ input, onChange }: Props) {
  const b = input.benefits ?? {};
  const perTable = input.tableRetention != null;
  function setBenefit(patch: Partial<NonNullable<SentinelCostInput["benefits"]>>) {
    onChange({ benefits: { ...b, ...patch } });
  }

  return (
    <div className="stack">
      <div className="field">
        <label>Analytics ingestion (from your data)</label>
        <input type="text" readOnly value={gbPerDay(input.analyticsGbPerDay)} />
        <p className="ai-note">Derived from the parsed/estimated sources above.</p>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="lake">Data Lake / Auxiliary (GB/day)</label>
          <input
            id="lake"
            type="number"
            min={0}
            value={input.dataLakeGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ dataLakeGbPerDay: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="opt">Ingestion optimization (%)</label>
          <input
            id="opt"
            type="number"
            min={0}
            max={90}
            value={input.ingestionOptimizationPct != null ? input.ingestionOptimizationPct * 100 : ""}
            placeholder="0"
            onChange={(e) => {
              const n = num(e.target.value);
              onChange({ ingestionOptimizationPct: n != null ? n / 100 : undefined });
            }}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="iret">Interactive retention (months)</label>
          <input
            id="iret"
            type="number"
            min={0}
            disabled={perTable}
            value={input.interactiveRetentionMonths ?? ""}
            placeholder="3 (free)"
            onChange={(e) => onChange({ interactiveRetentionMonths: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="store">Long-term storage (months)</label>
          <input
            id="store"
            type="number"
            min={0}
            disabled={perTable}
            value={input.dataStorageMonths ?? ""}
            placeholder="12"
            onChange={(e) => onChange({ dataStorageMonths: num(e.target.value) })}
          />
        </div>
      </div>
      {perTable && (
        <p className="ai-note">Retention is managed per table below — these two are overridden.</p>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="search">Search (TB/month)</label>
          <input
            id="search"
            type="number"
            min={0}
            value={input.searchTbPerMonth ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ searchTbPerMonth: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="soar">SOAR actions / month</label>
          <input
            id="soar"
            type="number"
            min={0}
            value={input.soarActionsPerMonth ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ soarActionsPerMonth: num(e.target.value) })}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="scu">Security Copilot (SCUs)</label>
          <input
            id="scu"
            type="number"
            min={0}
            value={input.securityCopilotScu ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ securityCopilotScu: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="sap">Sentinel for SAP (SIDs)</label>
          <input
            id="sap"
            type="number"
            min={0}
            value={input.sapProductionSids ?? ""}
            placeholder="0"
            onChange={(e) => onChange({ sapProductionSids: num(e.target.value) })}
          />
        </div>
      </div>

      <div className="section-head">
        <span className="eyebrow">Free-ingestion benefits</span>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="e5">M365 E5 (GB/day)</label>
          <input
            id="e5"
            type="number"
            min={0}
            value={b.m365E5FreeGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => setBenefit({ m365E5FreeGbPerDay: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="def">Defender Servers P2 (GB/day)</label>
          <input
            id="def"
            type="number"
            min={0}
            value={b.defenderP2FreeGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => setBenefit({ defenderP2FreeGbPerDay: num(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="freesrc">Always-free sources (GB/day)</label>
          <input
            id="freesrc"
            type="number"
            min={0}
            value={b.freeDataSourceGbPerDay ?? ""}
            placeholder="0"
            onChange={(e) => setBenefit({ freeDataSourceGbPerDay: num(e.target.value) })}
          />
        </div>
      </div>
    </div>
  );
}
