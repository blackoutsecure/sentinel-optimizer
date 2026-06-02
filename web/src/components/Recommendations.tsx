import { useState } from "react";
import type { NormalizedResult } from "@engine/schema/normalization.js";
import type { SentinelCostEstimate, SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import { generateRecommendations, totalSavings, type Recommendation } from "../lib/recommendations.js";
import { buildSummary, requestAiSummary } from "../lib/aiClient.js";
import { money } from "../lib/format.js";

interface Props {
  result: NormalizedResult;
  cost: SentinelCostEstimate;
  input: SentinelCostInput;
  vendorLabel: string;
}

const SEV_LABEL: Record<Recommendation["severity"], string> = {
  high: "High impact",
  med: "Medium",
  low: "Low",
};

export default function Recommendations({ result, cost, input, vendorLabel }: Props) {
  const recs = generateRecommendations({ result, cost, input });
  const savings = totalSavings(recs);

  const [aiText, setAiText] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | undefined>(undefined);
  const [aiState, setAiState] = useState<"idle" | "loading" | "error">("idle");
  const [aiError, setAiError] = useState<string | null>(null);

  async function enhance() {
    setAiState("loading");
    setAiError(null);
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
      setAiText(out.text);
      setAiModel(out.model);
      setAiState("idle");
    } catch (e) {
      setAiError((e as Error).message);
      setAiState("error");
    }
  }

  return (
    <div className="stack">
      <div className="section-head">
        <span className="eyebrow">Recommendations</span>
        {savings > 0 && (
          <span className="save-pill">Est. up to {money(savings)}/mo in savings</span>
        )}
      </div>

      {recs.length === 0 ? (
        <p className="ai-note">No obvious optimizations found — your configuration looks lean.</p>
      ) : (
        <div className="stack">
          {recs.map((r) => (
            <div key={r.id} className={`rec ${r.severity}`}>
              <div className="rec-head">
                <span className={`sev ${r.severity}`}>{SEV_LABEL[r.severity]}</span>
                <strong>{r.title}</strong>
                {r.monthlySavings != null && r.monthlySavings > 0 && (
                  <span className="save">~{money(r.monthlySavings)}/mo</span>
                )}
              </div>
              <p>{r.detail}</p>
            </div>
          ))}
        </div>
      )}

      <div className="ai-out">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <strong>AI executive summary</strong>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={enhance}
            disabled={aiState === "loading"}
          >
            {aiState === "loading" ? "Generating…" : aiText ? "Regenerate" : "Enhance with AI"}
          </button>
        </div>
        <p className="ai-note">
          Optional. Sends only aggregated totals (GB/day, cost categories, recommendation titles) —
          never your raw logs.
        </p>
        {aiState === "error" && aiError && <div className="error-box">{aiError}</div>}
        {aiText && <div className="ai-body">{aiText}</div>}
        {aiText && aiModel && <p className="ai-note">Model: {aiModel}</p>}
      </div>
    </div>
  );
}
