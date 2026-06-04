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

function inferLaneProfileFromAiText(text: string | null): "detectionFirst" | "balanced" | "costFirst" | null {
  if (!text) return null;
  const t = text.toLowerCase();

  const costSignals = [
    "cost-first",
    "basic / auxiliary",
    "basic/auxiliary",
    "data lake",
    "reduce spend",
    "lower-cost",
    "tiering",
  ];
  const detectionSignals = [
    "detection-first",
    "real-time detection",
    "high-fidelity",
    "keep in analytics",
    "hot path",
    "coverage first",
  ];

  const hasCost = costSignals.some((s) => t.includes(s));
  const hasDetection = detectionSignals.some((s) => t.includes(s));

  if (hasCost && !hasDetection) return "costFirst";
  if (hasDetection && !hasCost) return "detectionFirst";
  return null;
}

export default function Optimizer() {
  const [mode, setMode] = useState<Mode>("paste");
  const [vendor, setVendor] = useState<Vendor>("sentinel");
  const [result, setResult] = useState<NormalizedResult | null>(null);
  const [vendorLabel, setVendorLabel] = useState("Microsoft Sentinel");
  const [costInput, setCostInput] = useState<SentinelCostInput>(BASE_INPUT);
  const [ai, setAi] = useState<AiState>(IDLE_AI);
  const [aiStyle, setAiStyle] = useState<"executive" | "technical" | "board">("executive");
  const [provenance, setProvenance] = useState<ExportProvenance>(DEFAULT_PROVENANCE);

  function adoptResult(r: NormalizedResult, label: string, src: ExportProvenance) {
    setResult(r);
    setVendorLabel(label);
    setProvenance(src);
    setAi(IDLE_AI);
    setCostInput((prev) => ({
      ...prev,
      analyticsGbPerDay: r.totals?.gbPerDay ?? 0,
      basicAuxGbPerDay: undefined,
      dataLakeGbPerDay: undefined,
      tableRetention: undefined,
    }));
  }

  const cost = useMemo(() => {
    if (!result) return null;
    return estimateMonthlyCost(costInput);
  }, [result, costInput]);

  const suggestedLaneProfile = useMemo<"detectionFirst" | "balanced" | "costFirst">(() => {
    const aiSuggested = inferLaneProfileFromAiText(ai.text);
    if (aiSuggested) return aiSuggested;
    if (!result || !cost) return "balanced";
    const recs = generateRecommendations({ result, cost, input: costInput });
    const tiering = recs.find((r) => r.id === "tiering");
    if (tiering && (tiering.severity === "high" || tiering.severity === "med")) return "costFirst";
    const concentration = recs.find((r) => r.id === "concentration");
    if (concentration?.severity === "high") return "detectionFirst";
    return "balanced";
  }, [result, cost, costInput, ai.text]);

  function patchInput(patch: Partial<SentinelCostInput>) {
    setCostInput((prev) => ({ ...prev, ...patch }));
  }

  async function enhance() {
    if (!result || !cost) return;
    setAi((prev) => ({ ...prev, state: "loading", error: null }));
    const recs = generateRecommendations({ result, cost, input: costInput });
    const summary = buildSummary({
      vendor: vendorLabel,
      summaryStyle: aiStyle,
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
                <CostControls
                  input={costInput}
                  cost={cost}
                  onChange={patchInput}
                  suggestedLaneProfile={suggestedLaneProfile}
                  autoPlacementSeed={`${vendor}:${result.totals?.gbPerDay ?? 0}:${provenance.mode}`}
                />
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
                aiStyle={aiStyle}
                onAiStyleChange={setAiStyle}
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
