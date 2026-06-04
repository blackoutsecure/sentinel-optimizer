import { useMemo, useState } from "react";
import type { NormalizedResult } from "@engine/schema/normalization.js";
import type { SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import { estimateMonthlyCost } from "@engine/pricing/index.js";
import { DEFAULT_REGION_ID } from "@engine/pricing/regions.js";
import type { Vendor } from "../lib/examples.js";
import { buildSummary, requestAiSummary } from "../lib/aiClient.js";
import { generateRecommendations } from "../lib/recommendations.js";
import type { ExportProvenance } from "../lib/exporters.js";
import DataInput from "./DataInput.js";
import InventoryWizard from "./InventoryWizard.js";
import CostControls from "./CostControls.js";
import RegionControls from "./RegionControls.js";
import RetentionTable from "./RetentionTable.js";
import ResultsDashboard from "./ResultsDashboard.js";
import { SourceBreakdownChart, CostBreakdownChart } from "./Charts.js";
import Recommendations, { type AiState } from "./Recommendations.js";
import ExportBar from "./ExportBar.js";

type Mode = "paste" | "wizard";

const BASE_INPUT: SentinelCostInput = { analyticsGbPerDay: 0, regionId: DEFAULT_REGION_ID };
const IDLE_AI: AiState = { text: null, state: "idle", error: null };
const DEFAULT_PROVENANCE: ExportProvenance = { mode: "query-export" };

export default function Optimizer() {
  const [mode, setMode] = useState<Mode>("paste");
  const [vendor, setVendor] = useState<Vendor>("sentinel");
  const [result, setResult] = useState<NormalizedResult | null>(null);
  const [vendorLabel, setVendorLabel] = useState("Microsoft Sentinel");
  const [costInput, setCostInput] = useState<SentinelCostInput>(BASE_INPUT);
  const [ai, setAi] = useState<AiState>(IDLE_AI);
  const [provenance, setProvenance] = useState<ExportProvenance>(DEFAULT_PROVENANCE);

  function adoptResult(r: NormalizedResult, label: string, src: ExportProvenance) {
    setResult(r);
    setVendorLabel(label);
    setProvenance(src);
    setAi(IDLE_AI);
    setCostInput((prev) => ({
      ...prev,
      analyticsGbPerDay: r.totals?.gbPerDay ?? 0,
      tableRetention: undefined,
    }));
  }

  const cost = useMemo(() => {
    if (!result) return null;
    return estimateMonthlyCost(costInput);
  }, [result, costInput]);

  function patchInput(patch: Partial<SentinelCostInput>) {
    setCostInput((prev) => ({ ...prev, ...patch }));
  }

  async function enhance() {
    if (!result || !cost) return;
    setAi((prev) => ({ ...prev, state: "loading", error: null }));
    const recs = generateRecommendations({ result, cost, input: costInput });
    const summary = buildSummary({
      vendor: vendorLabel,
      totalGbPerDay: result.totals?.gbPerDay ?? 0,
      sources: result.sources,
      monthlyCost: cost.monthlyCost,
      breakdown: cost.breakdown as unknown as Record<string, number>,
      billableAnalyticsGbPerDay: cost.billableAnalyticsGbPerDay,
      benefitGbPerDay: cost.benefitGbPerDay,
      recommendations: recs,
    });
    try {
      const out = await requestAiSummary(summary);
      setAi({ text: out.text, ...(out.model ? { model: out.model } : {}), state: "idle", error: null });
    } catch (e) {
      setAi((prev) => ({ ...prev, state: "error", error: (e as Error).message }));
    }
  }

  function reset() {
    setMode("paste");
    setVendor("sentinel");
    setResult(null);
    setVendorLabel("Microsoft Sentinel");
    setProvenance(DEFAULT_PROVENANCE);
    setCostInput(BASE_INPUT);
    setAi(IDLE_AI);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
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
              onParsed={(r, label, src) => adoptResult(r, label, src)}
            />
          ) : (
            <InventoryWizard onEstimated={(r, src) => adoptResult(r, "Estimated (Sentinel)", src)} />
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
                <RegionControls input={costInput} cost={cost} onChange={patchInput} />
                <hr className="mt-sm" />
                <CostControls input={costInput} cost={cost} onChange={patchInput} />
              </div>
              <div className="panel panel-pad">
                <ResultsDashboard result={result} cost={cost} input={costInput} vendorLabel={vendorLabel} />
              </div>
            </div>
            <div className="panel panel-pad">
              <RetentionTable result={result} input={costInput} onChange={patchInput} />
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <span className="eyebrow">3 · Visualize</span>
            </div>
            <div className="grid-2">
              <div className="panel panel-pad" id="export-chart-sources">
                <h3>Ingest by source</h3>
                <SourceBreakdownChart result={result} />
              </div>
              <div className="panel panel-pad" id="export-chart-cost">
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
                ai={ai}
                onEnhance={enhance}
              />
            </div>
          </section>

          <section className="section">
            <div className="panel panel-pad">
              <ExportBar
                result={result}
                cost={cost}
                input={costInput}
                vendorLabel={vendorLabel}
                provenance={provenance}
                aiSummary={ai.text}
                {...(ai.model ? { aiModel: ai.model } : {})}
                onReset={reset}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
