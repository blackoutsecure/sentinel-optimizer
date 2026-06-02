import { useMemo, useState } from "react";
import type { NormalizedResult } from "@engine/schema/normalization.js";
import type { SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import { estimateMonthlyCost } from "@engine/pricing/index.js";
import type { Vendor } from "../lib/examples.js";
import DataInput from "./DataInput.js";
import InventoryWizard from "./InventoryWizard.js";
import CostControls from "./CostControls.js";
import ResultsDashboard from "./ResultsDashboard.js";
import { SourceBreakdownChart, CostBreakdownChart } from "./Charts.js";
import Recommendations from "./Recommendations.js";

type Mode = "paste" | "wizard";

const BASE_INPUT: SentinelCostInput = { analyticsGbPerDay: 0 };

export default function Optimizer() {
  const [mode, setMode] = useState<Mode>("paste");
  const [vendor, setVendor] = useState<Vendor>("sentinel");
  const [result, setResult] = useState<NormalizedResult | null>(null);
  const [vendorLabel, setVendorLabel] = useState("Microsoft Sentinel");
  const [costInput, setCostInput] = useState<SentinelCostInput>(BASE_INPUT);

  function adoptResult(r: NormalizedResult, label: string) {
    setResult(r);
    setVendorLabel(label);
    setCostInput((prev) => ({ ...prev, analyticsGbPerDay: r.totals?.gbPerDay ?? 0 }));
  }

  const cost = useMemo(() => {
    if (!result) return null;
    return estimateMonthlyCost(costInput);
  }, [result, costInput]);

  function patchInput(patch: Partial<SentinelCostInput>) {
    setCostInput((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div className="stack">
      <section className="section">
        <div className="section-head">
          <span className="eyebrow">1 · Provide data</span>
          <div className="segmented" role="tablist" aria-label="Input mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "paste"}
              className={mode === "paste" ? "active" : ""}
              onClick={() => setMode("paste")}
            >
              Paste / upload export
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "wizard"}
              className={mode === "wizard" ? "active" : ""}
              onClick={() => setMode("wizard")}
            >
              Estimate from inventory
            </button>
          </div>
        </div>
        <div className="panel panel-pad">
          {mode === "paste" ? (
            <DataInput
              vendor={vendor}
              onVendorChange={setVendor}
              onParsed={(r, label) => adoptResult(r, label)}
            />
          ) : (
            <InventoryWizard onEstimated={(r) => adoptResult(r, "Estimated (Sentinel)")} />
          )}
        </div>
      </section>

      {result && cost && (
        <>
          <section className="section">
            <div className="section-head">
              <span className="eyebrow">2 · Tune cost model</span>
            </div>
            <div className="grid-2">
              <div className="panel panel-pad">
                <CostControls input={costInput} onChange={patchInput} />
              </div>
              <div className="panel panel-pad">
                <ResultsDashboard result={result} cost={cost} vendorLabel={vendorLabel} />
              </div>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <span className="eyebrow">3 · Visualize</span>
            </div>
            <div className="grid-2">
              <div className="panel panel-pad">
                <h3>Ingest by source</h3>
                <SourceBreakdownChart result={result} />
              </div>
              <div className="panel panel-pad">
                <h3>Cost by category</h3>
                <CostBreakdownChart breakdown={cost.breakdown} />
              </div>
            </div>
          </section>

          <section className="section">
            <div className="panel panel-pad">
              <Recommendations
                result={result}
                cost={cost}
                input={costInput}
                vendorLabel={vendorLabel}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
