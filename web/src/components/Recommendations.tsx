import type { NormalizedResult } from "@engine/schema/normalization.js";
import type { SentinelCostEstimate, SentinelCostInput } from "@engine/pricing/sentinelPricing.js";
import { generateRecommendations, totalSavings, type Recommendation } from "../lib/recommendations.js";
import { money } from "../lib/format.js";

export interface AiState {
  text: string | null;
  model?: string;
  state: "idle" | "loading" | "error";
  error: string | null;
}

interface Props {
  result: NormalizedResult;
  cost: SentinelCostEstimate;
  input: SentinelCostInput;
  vendorLabel: string;
  ai: AiState;
  aiStyle: "executive" | "technical" | "board";
  onAiStyleChange: (style: "executive" | "technical" | "board") => void;
  onEnhance: () => void;
}

const SEV_LABEL: Record<Recommendation["severity"], string> = {
  high: "High impact",
  med: "Medium",
  low: "Low",
};

export default function Recommendations({
  result,
  cost,
  input,
  ai,
  aiStyle,
  onAiStyleChange,
  onEnhance,
}: Props) {
  const recs = generateRecommendations({ result, cost, input });
  const savings = totalSavings(recs);

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
              {r.migrationExamples && r.migrationExamples.length > 0 && (
                <ul>
                  {r.migrationExamples.map((item, idx) => (
                    <li key={`${r.id}-example-${idx}`}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="ai-out">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <strong>AI summary</strong>
          <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
            <label htmlFor="ai-style" className="ai-note" style={{ margin: 0 }}>
              Style
            </label>
            <select
              id="ai-style"
              value={aiStyle}
              onChange={(e) => onAiStyleChange(e.target.value as "executive" | "technical" | "board")}
              disabled={ai.state === "loading"}
            >
              <option value="executive">Executive</option>
              <option value="technical">Technical</option>
              <option value="board">Board-ready</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onEnhance}
              disabled={ai.state === "loading"}
            >
              {ai.state === "loading" ? "Generating..." : ai.text ? "Regenerate" : "Enhance with AI"}
            </button>
          </div>
        </div>
        <p className="ai-note">
          Optional. Sends only aggregated totals (GB/day, cost categories, recommendation titles) —
          never your raw logs.
        </p>
        {ai.state === "error" && ai.error && <div className="error-box">{ai.error}</div>}
        {ai.text && <div className="ai-body">{ai.text}</div>}
        {ai.text && ai.model && <p className="ai-note">Model: {ai.model}</p>}
      </div>
    </div>
  );
}
